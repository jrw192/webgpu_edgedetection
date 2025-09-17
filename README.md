https://homepages.inf.ed.ac.uk/rbf/HIPR2/sobel.htm


| Step | Action | Result |
| :--- | :--- | :--- |
| 1. Placement | Center the $3 \times 3$ kernel over pixel $(x,y)$ in the original image. | |
| 2. Multiplication | Multiply each of the 9 kernel values (e.g., $-1, 0, +1, -2, \dots$) by the corresponding 9 pixel intensity values. | Nine intermediate products. |
| 3. Summation | Add all nine intermediate products together. | One single numerical value. |
| 4. Assignment | This final numerical value becomes the new intensity for pixel $(x,y)$ in the output image. | The original pixel $(x,y)$ is "replaced" by a value that represents the gradient (edge strength) at that location. |