# Use a Node.js image with a specific version
FROM node:20-bullseye

# Install Chrome dependencies and yt-dlp
RUN apt-get update \
    && apt-get install -y \
    chromium \
    chromium-driver \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    --no-install-recommends \
    && pip3 install --no-cache-dir yt-dlp \
    && rm -rf /var/lib/apt/lists/*

# Set up working directory
WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install

# Copy the application and necessary files
COPY . . 

# Set correct permissions
RUN chown -R node:node /app

# Set environment variables for Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Switch to non-root user
USER node

# Expose port
EXPOSE 8000

# Start the application
CMD ["npm", "run", "start"]
