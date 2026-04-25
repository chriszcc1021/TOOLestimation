#!/bin/bash
# Product Forecast Tool Starter
cd "$(dirname "$0")"
echo "🚀 Starting Product Forecast Server..."
echo "📊 Open: http://localhost:3031"
node --use-env-proxy server.js
