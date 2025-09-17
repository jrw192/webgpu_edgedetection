async function main(gridSize) {
    // ------------ setup ------------
    const canvas = document.querySelector("canvas");
    if (!navigator.gpu) {
        alert("WebGPU not supported on this browser.");
        throw new Error("WebGPU not supported on this browser.");
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        throw new Error("No appropriate GPUAdapter found.");
    }
    const device = await adapter.requestDevice({
        // requiredFeatures: ["float32-blendable"],
    });

    const context = canvas.getContext("webgpu");
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device: device,
        format: canvasFormat,
    });

    // ------------ load image ------------
    const fileInput = document.getElementById('imageInput');
    console.log("fileInput", fileInput);

    async function getImageBitmap() {
        // Get the first file from the user's selection
        const file = fileInput.files[0];
        console.log("file selected", file);
        if (!file) {
            console.log("no file selected.");
            return;
        }

        try {
            // Create an ImageBitmap directly from the File object
            const imageBitmap = await createImageBitmap(file);
            console.log("success");
            // You can now use the imageBitmap for your WebGPU texture, canvas, etc.
            return imageBitmap;
        } catch (error) {
            console.error("error", error);
        }
    }
    const imageBitmap = await getImageBitmap();

    const image_X = imageBitmap.width;
    const image_Y = imageBitmap.height;

    canvas.width = image_X;
    canvas.height = image_Y;

    // ------------ create texture and textureView ------------
    const textureDescriptor = {
        label: "input texture",
        size: [image_X, image_Y],
        format: 'r32float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    };
    const texture = device.createTexture(textureDescriptor);

    device.queue.copyExternalImageToTexture(
        { source: imageBitmap },
        { texture: texture },
        [image_X, image_Y]
    );


    const outputTextureDescriptor = {
        label: "output texture",
        size: [image_X, image_Y],
        format: 'r32float',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    };
    const outputTexture = device.createTexture(outputTextureDescriptor);

    // ------------ vertex + frag shader module ------------
    const shaderModule = device.createShaderModule({
        label: "shader module",
        code: /*wgsl*/`
            struct FragmentInput {
            @location(1) instance: f32,
            }

            @group(0) @binding(0) var inputTexture: texture_2d<f32>;
            @group(0) @binding(1) var outputTexture: texture_storage_2d<r32float, read_write>;
            @group(0) @binding(2) var sampler_instance: sampler;

            @vertex
            fn vertexMain(@builtin(vertex_index) in_vertex_index: u32) -> @builtin(position) vec4<f32> {
               let pos = array<vec2<f32>, 6>(
                    vec2<f32>( 1.0,  1.0),
                    vec2<f32>( 1.0, -1.0),
                    vec2<f32>(-1.0, -1.0),
                    vec2<f32>( 1.0,  1.0),
                    vec2<f32>(-1.0, -1.0),
                    vec2<f32>(-1.0,  1.0)
                );
                return vec4<f32>(pos[in_vertex_index], 0.0, 1.0);
            }
            
            @fragment
            fn fragmentMain(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
                let textureSize = vec2<f32>(textureDimensions(outputTexture));
                let uv = fragCoord.xy / textureSize;
                let coords = vec2<u32>(uv * textureSize);

                return textureLoad(outputTexture, coords);
            }
        `
    });

    // ------------ compute shader ------------
    const WORKGROUP_SIZE = 8;
    const computeShaderModule = device.createShaderModule({
        label: "compute shader module",
        code: /*wgsl*/`

            @group(0) @binding(0) var inputTexture: texture_2d<f32>;
            @group(0) @binding(1) var outputTexture: texture_storage_2d<r32float, read_write>;
            @compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE}, 1)
            fn computeMain(@builtin(global_invocation_id) id: vec3<u32>) {
                // top left
                var coords = vec2<u32>(id.x-1, id.y-1);
                let valueTL = -1 * textureLoad(inputTexture, coords, 0);

                // top center
                coords = vec2<u32>(id.x, id.y-1);
                let valueTC =  0 * textureLoad(inputTexture, coords, 0);
                
                // top right
                coords = vec2<u32>(id.x+1, id.y-1);
                let valueTR = 1 * textureLoad(inputTexture, coords, 0);

                // center left
                coords = vec2<u32>(id.x, id.y-1);
                let valueCL = -2 * textureLoad(inputTexture, coords, 0);

                // center 
                coords = vec2<u32>(id.x, id.y);
                let valueCC = 0 * textureLoad(inputTexture, coords, 0);

                // center right
                coords = vec2<u32>(id.x, id.y+1);
                let valueCR = 2 * textureLoad(inputTexture, coords, 0);

                // bottom left
                coords = vec2<u32>(id.x+1, id.y-1);
                let valueBL = -1 * textureLoad(inputTexture, coords, 0);

                // bottom center
                coords = vec2<u32>(id.x+1, id.y);
                let valueBC = 0 * textureLoad(inputTexture, coords, 0);

                // bottom right
                coords = vec2<u32>(id.x+1, id.y+1);
                let valueBR = 1 * textureLoad(inputTexture, coords, 0);

                let value = valueTL + valueTC + valueTR + valueCL + valueCC + valueCR + valueBL + valueBC + valueBR;

                textureStore(outputTexture, id.xy, 0.2+value);
            }
        `
    });


    // ------------ set up bind groups ------------
    const bindGroupLayout = device.createBindGroupLayout({
        label: "bind group layout",
        entries: [{
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
            texture: {
                sampleType: "unfilterable-float",
                viewDimension: "2d",
            },
        }, {
            binding: 1,
            visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
            storageTexture: {
                access: "read-write",
                format: "r32float",
                viewDimension: "2d",
            },
        }, {
            binding: 2,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            sampler: {
                type: 'filtering',
            }
        }]
    });

    const pipelineLayout = device.createPipelineLayout({
        label: "pipeline layout",
        bindGroupLayouts: [bindGroupLayout],
    });

    const bindGroup = device.createBindGroup({
        label: "bind group A",
        layout: bindGroupLayout,
        entries: [{
            binding: 0,
            resource: texture.createView(),
        },
        {
            binding: 1,
            resource: outputTexture.createView(),
        },
        {
            binding: 2,
            resource: device.createSampler({
                magFilter: 'linear',
                minFilter: 'linear',
            }),
        }],
    });

    // ------------ render + compute pipelines ------------
    const renderPipeline = device.createRenderPipeline({
        label: "render pipeline",
        layout: pipelineLayout,
        vertex: {
            module: shaderModule,
            entryPoint: "vertexMain",
        },
        fragment: {
            module: shaderModule,
            entryPoint: "fragmentMain",
            targets: [{
                format: canvasFormat,
            }]
        }
    });

    const computePipeline = device.createComputePipeline({
        label: "compute pipeline",
        layout: pipelineLayout,
        compute: {
            module: computeShaderModule,
            entryPoint: "computeMain",
        }
    });

    async function render() {
        const encoder = device.createCommandEncoder();
        // compute pass
        const computePass = encoder.beginComputePass();
        computePass.setPipeline(computePipeline);
        computePass.setBindGroup(0, bindGroup);

        computePass.dispatchWorkgroups(image_X / WORKGROUP_SIZE, image_Y / WORKGROUP_SIZE);
        computePass.end();


        const renderPass = encoder.beginRenderPass({
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                loadOp: "clear",
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                storeOp: "store",
            }]
        });
        renderPass.setBindGroup(0, bindGroup);

        renderPass.setPipeline(renderPipeline);
        renderPass.draw(6, 1, 0, 0); // 6 vertices for 2 triangles
        renderPass.end();

        device.queue.submit([encoder.finish()]);

    }

    render();

}