#!/bin/bash

# Railway Deployment Helper Script
# This script helps prepare your project for Railway deployment

echo "🚀 Railway Deployment Helper"
echo "=============================="
echo ""

# Check if git is initialized
if [ ! -d ".git" ]; then
    echo "📦 Initializing git repository..."
    git init
    echo "✅ Git initialized"
fi

# Check if GitHub remote exists
if ! git remote | grep -q "origin"; then
    echo ""
    echo "🔗 GitHub remote not found."
    echo "Please add your GitHub remote:"
    echo ""
    echo "git remote add origin https://github.com/kdt82/raffle.git"
    echo ""
    read -p "Press Enter after adding the remote..."
fi

# Add all files
echo ""
echo "📝 Adding files to git..."
git add .

# Commit
echo ""
read -p "Enter commit message (or press Enter for default): " commit_msg
if [ -z "$commit_msg" ]; then
    commit_msg="Prepare for Railway deployment"
fi

git commit -m "$commit_msg"
echo "✅ Changes committed"

# Push to GitHub
echo ""
echo "📤 Pushing to GitHub..."
git push -u origin main || git push -u origin master

echo ""
echo "✅ Code pushed to GitHub!"
echo ""
echo "=============================="
echo "Next Steps:"
echo "=============================="
echo ""
echo "1. Go to https://railway.app/new"
echo "2. Click 'Deploy from GitHub repo'"
echo "3. Select 'kdt82/raffle'"
echo "4. Add PostgreSQL database"
echo "5. Add Redis database"
echo "6. Set environment variables:"
echo ""
echo "   Required Variables:"
echo "   - TELEGRAM_BOT_TOKEN"
echo "   - ADMIN_USER_IDS"
echo "   - REDIS_HOST"
echo "   - REDIS_PORT"
echo "   - REDIS_PASSWORD"
echo ""
echo "7. Wait for deployment to complete"
echo "8. Test your bot in Telegram!"
echo ""
echo "📚 See RAILWAY_QUICKSTART.md for detailed guide"
echo ""

