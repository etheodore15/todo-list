#!/usr/bin/env bash
# One-command backend deploy for Idea → Todo (Infrastructure-as-Code).
# Reproduces the whole Firebase backend — Firestore rules + indexes and the AI
# proxy function — from this repo. The app front-end deploys separately via
# GitHub Pages (just push to main).
#
# Prerequisites (one-time):
#   npm i -g firebase-tools && firebase login
#   cp .firebaserc.example .firebaserc   # then put your project id in it
#   firebase functions:secrets:set GEMINI_KEY   # paste your Gemini key
#
# Usage:
#   ./deploy-backend.sh            # deploy rules + indexes + functions
#   ./deploy-backend.sh rules      # just Firestore rules (fast, e.g. after
#                                   # editing the operator UID allowlist)
set -euo pipefail

if [ ! -f .firebaserc ]; then
  echo "✗ No .firebaserc — copy .firebaserc.example to .firebaserc and set your project id."
  exit 1
fi

case "${1:-all}" in
  rules)     firebase deploy --only firestore:rules ;;
  functions) firebase deploy --only functions ;;
  all)       firebase deploy --only firestore:rules,firestore:indexes,functions ;;
  *)         echo "usage: ./deploy-backend.sh [all|rules|functions]"; exit 1 ;;
esac

echo "✓ Backend deployed. Front-end updates ship via 'git push' (GitHub Pages)."
