# Releasing

How a new version of AI Visibility Checker reaches npm.

## Once: reserve the name

npm configures trusted publishing in the settings of an existing package, so the name has to exist before the first automated release. Reserve it with an empty placeholder, version 0.0.0, that installs no command:

```
mkdir /tmp/avc-placeholder && cd /tmp/avc-placeholder
cat > package.json <<'JSON'
{
  "name": "ai-visibility-checker",
  "version": "0.0.0",
  "description": "Name reserved for https://github.com/pixelstrunk/ai-visibility-checker. The first real release is 0.1.0.",
  "license": "MIT",
  "repository": { "type": "git", "url": "https://github.com/pixelstrunk/ai-visibility-checker" }
}
JSON
npm publish --auth-type=web
```

Run it in a real terminal so the passkey prompt works. Then, on npmjs.com, open the package settings and add the trusted publisher: owner `pixelstrunk`, repository `ai-visibility-checker`, workflow `release.yml`, no environment. From then on every release goes through the workflow, without tokens.

The skill runs `npx ai-visibility-checker@0`, which picks the highest 0.x version. Until 0.1.0 is out it resolves to the placeholder, which has no command, so the skill fails cleanly instead of running anything.

## Every release

A release is triggered by pushing a git tag `vX.Y.Z`. GitHub Actions (`.github/workflows/release.yml`) then tests, publishes to npm and, only if that worked, creates the GitHub release.

1. Bump the version in all three places, they must stay in sync (CI fails if they drift):
   - `package.json` -> `"version": "X.Y.Z"`
   - `src/cli.ts` -> `VERSION = "X.Y.Z"`
   - `.claude-plugin/plugin.json` -> `"version": "X.Y.Z"`
2. Update `CHANGELOG.md`.
3. Commit and push to `main`.
4. Create and push the tag:
   ```
   git tag -a vX.Y.Z -m "ai-visibility-checker vX.Y.Z"
   git push origin vX.Y.Z
   ```

## Major versions

Skill and README pin `@0`. Every 0.x release reaches every installed skill on its next run, so a 0.x release must never break the run folder format or the commands. A breaking change becomes 1.0.0, and only then do skill and README move to `@1`, on purpose.
