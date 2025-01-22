# Use a Node.js image with a specific version
FROM node:20-bullseye

# Set proxy environment variables for the build process
ARG HTTP_PROXY=http://pegpxagi-rotate:gzwdaqakp5wr@198.23.239.134:6540
ARG HTTPS_PROXY=http://pegpxagi-rotate:gzwdaqakp5wr@198.23.239.134:6540
ARG NO_PROXY=localhost,127.0.0.1

# Pass proxy settings to environment variables
ENV HTTP_PROXY=$HTTP_PROXY
ENV HTTPS_PROXY=$HTTPS_PROXY
ENV NO_PROXY=$NO_PROXY

# Install Chrome dependencies
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
    --no-install-recommends \
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
EXPOSE 7860

# Start the application
CMD ["npm", "run", "start"]
