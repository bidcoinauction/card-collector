# Football Brand Positioning Repository

This directory is structured as a **standalone repository payload** so the brand playbook can live independently from the card-collector codebase.

## What to copy into the new repo
- `README.md` (this file)
- `brand-positioning.md`

## Suggested new repository name
- `america-finds-football-playbook`
- `football-storytelling-brand-playbook`
- `world-cup-2026-content-playbook`

## Quick start for creating the standalone repository
```bash
mkdir america-finds-football-playbook
cd america-finds-football-playbook
cp -R /path/to/card-collector/brand-playbook-repo/* .
git init
git add .
git commit -m "Initial commit: football brand positioning playbook"
```

After that, connect your remote and push:
```bash
git remote add origin <your-new-repo-url>
git branch -M main
git push -u origin main
```
