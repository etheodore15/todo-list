#!/usr/bin/env bash
# One-command deploy for Idea → Todo (Infrastructure-as-Code).
# Reproduces the whole Firebase backend — Firestore rules + indexes, the AI
# proxy function, and (optionally) the app itself on Firebase Hosting — from
# this repo.
#
# Prerequisites (one-time):
#   npm i -g firebase-tools && firebase login
#   cp .firebaserc.example .firebaserc   # then put your project id in it
#   firebase functions:secrets:set GEMINI_KEY   # paste your Gemini key
#
# Usage:
#   ./deploy-backend.sh            # rules + indexes + functions (backend only)
#   ./deploy-backend.sh rules      # just Firestore rules (fast, e.g. after
#                                   # editing the operator UID allowlist)
#   ./deploy-backend.sh hosting    # publish the app to Firebase Hosting
#   ./deploy-backend.sh everything # backend + hosting in one shot
set -euo pipefail

if [ ! -f .firebaserc ]; then
  echo "✗ No .firebaserc — copy .firebaserc.example to .firebaserc and set your project id."
  exit 1
fi

case "${1:-all}" in
  rules)      firebase deploy --only firestore:rules ;;
  functions)  firebase deploy --only functions ;;
  hosting)    firebase deploy --only hosting ;;
  all)        firebase deploy --only firestore:rules,firestore:indexes,functions ;;
  everything) firebase deploy --only firestore:rules,firestore:indexes,functions,hosting ;;
  *)          echo "usage: ./deploy-backend.sh [all|rules|functions|hosting|everything]"; exit 1 ;;
esac

echo "✓ Deployed. (GitHub Pages also still serves the app on 'git push' — both hosts can run in parallel.)"
