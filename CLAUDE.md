# Olly Olly VA — Claude Code Session Rules

## Start of every session
1. Run `git pull origin main` before touching any files
2. Run `git status` to check for any uncommitted changes
3. If git status shows uncommitted changes, commit them before doing anything else

## End of every session
1. Run `git add -A`
2. Run `git commit -m "brief description of what was built/fixed"`
3. Run `git push origin main`
4. Confirm the push succeeded before ending the session

## Never do these things
- Never delete the project folder or suggest recloning
- Never suggest `rm -rf` on the project directory
- Never overwrite files without reading them first
- Never commit only some files — always use `git add -A` to catch everything

## Vercel deploys automatically
Vercel is connected to GitHub. Every push to main triggers a production deploy automatically. Do NOT run `npx vercel --prod` separately.

## Project location
/Users/liz/olly-olly-va
