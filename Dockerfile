# ---------- Base image ----------
FROM node:20-bullseye

ENV DEBIAN_FRONTEND=noninteractive

# ---------- System dependencies ----------
RUN apt-get update && apt-get install -y \
    curl \
    git \
    ca-certificates \
    build-essential \
    wget \
    bash \
    && rm -rf /var/lib/apt/lists/*

# ---------- Install Miniconda ----------
ENV CONDA_DIR=/opt/conda
RUN wget -q https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -O /tmp/miniconda.sh && \
    bash /tmp/miniconda.sh -b -p $CONDA_DIR && \
    rm /tmp/miniconda.sh

ENV PATH=$CONDA_DIR/bin:$PATH

# ---------- Create Conda environment ----------
COPY environment.yml /tmp/environment.yml

RUN conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/main && \
    conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/r && \
    conda env create -f /tmp/environment.yml && \
    conda clean -afy

# Make conda env default
ENV CONDA_DEFAULT_ENV=dku-splat
ENV PATH=$CONDA_DIR/envs/dku-splat/bin:$PATH

# ---------- App setup ----------
WORKDIR /app

# Copy only dependency files first (better caching)
COPY package.json package-lock.json ./

RUN npm ci

# Copy rest of the project
COPY . .

# ---------- Default command ----------
CMD ["npm", "run", "dev"]