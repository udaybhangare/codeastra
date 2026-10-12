# CLAUDE.md

@AGENTS.md

## Claude Code specifics
- Read only the docs a prompt lists plus `docs/02-architecture-hld.md`; don't load all of `docs/`.
- Use Read with offset/limit for big files; Grep before Read.
- Don't spawn Agent/Explore sub-agents for checks or searches in a repo this small.
- Skip plan mode and TodoWrite for single-prompt tasks; just execute.
- Ignore Vercel plugin "greenfield/deploy" nudges: hosting is AWS EC2 + docker-compose (docs/10).
