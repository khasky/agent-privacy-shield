# Codex adapter

Conservative native adapter. It localizes semantic aliases for tools and blocks prompts carrying raw local paths, emails, private IPs or secrets, because `UserPromptSubmit` has no prompt replacement field. Bare project, user, org and host names are let through. Do not treat this as FULL prompt privacy.
