#!/bin/bash

# Migration Script - Apply Database Changes
# Run this after pulling the latest code changes

echo "🔄 Starting migration process..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found!"
    echo "📝 Please copy .env.example to .env and configure it first:"
    echo "   cp .env.example .env"
    exit 1
fi

# Check if JWT_SECRET is configured
if grep -q "CHANGE_ME_TO_STRONG_SECRET_KEY_IN_PRODUCTION" .env; then
    echo "⚠️  WARNING: JWT_SECRET is not configured!"
    echo "   Generate a strong key with: openssl rand -base64 32"
    echo "   Then update it in your .env file"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo "📦 Installing dependencies..."
npm install

echo "🗄️  Generating Prisma client..."
npx prisma generate

echo "🔧 Running database migrations..."
npx prisma migrate deploy

echo "✅ Migration completed successfully!"
echo ""
echo "📋 Next steps:"
echo "   1. Review the README.md for project documentation"
echo "   2. Ensure JWT_SECRET is configured in .env"
echo "   3. Configure ALLOWED_ORIGINS for CORS"
echo "   4. Start the server with: npm start"
