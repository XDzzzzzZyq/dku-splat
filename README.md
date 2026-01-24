# DKU Splat

**DKU Splat** is a WebGL-based implementation of **Reflective Gaussian Splatting (Ref-GS)** for real-time rendering of reflective surfaces in the browser. The project provides a containerized development and deployment workflow for DKU campus nevigation.

## Features

- WebGL-based real-time rendering  
- Implementation of **Reflective Gaussian Splatting**  
- Fully containerized frontend and backend  
- Simple build and run workflow with Docker Compose 


## Build

Build all images from scratch:

```bash
docker compose up --build
```
## Run
Start the frontend and backend services:
```bash
docker compose up frontend backend
```
Once running, access the application via your browser at the address specified by the frontend service.

## Test
Start the frontend and backend services:
```bash
docker compose up test
```

### Development Notes
Changes to frontend or backend code may require rebuilding the corresponding Docker image.

For iterative development, consider running individual services with mounted volumes.

# Reference
If you use this project in academic work, please cite:
```
@article{yao2024refGS,
  title   = {Reflective Gaussian Splatting},
  author  = {Yao, Yuxuan and Zeng, Zixuan and Gu, Chun and Zhu, Xiatian and Zhang, Li},
  journal = {arXiv preprint},
  year    = {2024}
}
```