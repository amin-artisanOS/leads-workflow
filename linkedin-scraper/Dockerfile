FROM apify/actor-node-playwright-chrome:18

# Copy package.json and package-lock.json
COPY package*.json ./

# Install NPM packages, skip optional and development dependencies to keep the
# image small. Also log progress in the npm to see if it is still running.
RUN npm --quiet set progress=false \
 && npm install --only=prod --no-optional \
 && echo "Installed NPM packages:" \
 && (npm list --only=prod --no-optional --all || true) \
 && echo "Node.js version:" \
 && node --version \
 && echo "NPM version:" \
 && npm --version

# Copy all files from the directory to the container
COPY . .

# Set environment variables for Apify
ENV APIFY_DISABLE_OUTDATED_WARNING=1
ENV NODE_PATH=./node_modules

# Set the entrypoint
CMD ["node", "scraper.js"]
