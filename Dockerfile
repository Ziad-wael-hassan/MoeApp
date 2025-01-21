# Use a Node.js image with a specific version
FROM node:20-bullseye

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


# Test DNS resolution and clean up
RUN apt-get update && apt-get install -y dnsutils && nslookup web.whatsapp.com && apt-get remove --purge -y dnsutils && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

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
