/** Injected when the user starts planning from the board first-run callout. */
export const PLANNING_INIT_INITIAL_PROMPT = `We just created this Fluxx project. Please help initialize the project context.

Your goals:
- Read the attached repositories and any existing planning files.
- Ask the user a small number of focused questions about product vision, architecture, constraints, and near-term goals.
- Create or update planning/docs/vision.md with the product purpose, target users, key workflows, non-goals, and success criteria.
- Create or update planning/docs/architecture.md with the system shape, important components, data/storage boundaries, repo layout, build/test commands, and known risks.
- If this project has no repositories yet, rely on the user's answers and any existing planning docs on disk.
- Keep the docs concise, accurate, and useful for future agents.

Do not start implementation work unless the user explicitly asks.`;
