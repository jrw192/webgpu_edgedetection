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
    const device = await adapter.requestDevice();

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


    // ------------ create texture and textureView ------------
    const textureDescriptor = {
        label: "input texture",
        size: [image_X, image_Y],
        format: 'rgba8unorm',
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
        format: 'rgba8unorm',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    };
    const outputTexture = device.createTexture(outputTextureDescriptor);

    // ------------ compute shader ------------
    const WORKGROUP_SIZE = 8;
    const computeShaderModule = device.createShaderModule({
        label: "compute shader module",
        code: /*wgsl*/`

            @group(0) @binding(0) var inputTexture: texture_2d<f32>;
            @group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
            @compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
            fn computeMain() {}
        `
    });


    // ------------ set up bind groups ------------
    const bindGroupLayout = device.createBindGroupLayout({
        label: "bind group layout",
        entries: [{
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            texture: {
                sampleType: "float",
                viewDimension: "2d",
            },
        }, {
            binding: 1,
            visibility: GPUShaderStage.COMPUTE,
            storageTexture: {
                access: "write-only",
                format: "rgba8unorm",
                viewDimension: "2d",
            },
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
        }],
    });

    // ------------ render + compute pipelines ------------
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
        const workgroupCount = Math.ceil(8);

        computePass.dispatchWorkgroups(workgroupCount, workgroupCount);
        computePass.end();
        device.queue.submit([encoder.finish()]);
    }

    render();

}