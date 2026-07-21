# Public release procedure

The existing development repository may contain rewritten refs, personal author metadata, or deleted organization-specific content. Do not mirror-push it into the public repository.

## First public release

1. Run the local private denylist in addition to built-in checks:

   ```sh
   CC_NEXS_PUBLIC_DENYLIST_FILE=/absolute/path/to/private-terms.txt pnpm audit:public
   pnpm verify:reproducible
   pnpm validate:plugins
   ```

2. Export the reviewed working tree into a new empty directory without `.git`, `.cc-nexs`, runtime state, worktrees, or ignored files. Use the repository's tracked file list after the release changes are committed; do not copy `.git` or use `git push --mirror`.
3. Initialize a new Git repository with `main`, configure a GitHub noreply author address, make one audited import commit for the version in `package.json`, and run `pnpm audit:public:history` there.
4. Create a new GitHub repository, enable private vulnerability reporting and branch protection, then push only `main` and the signed release tag.
5. Verify GitHub Actions before making the repository discoverable.

The private denylist file must stay outside this repository. Diagnostics intentionally print only finding codes and locations, never the matched value.

## Subsequent releases

Use normal reviewed pull requests from the clean public repository. Release only when the working tree is clean, CI passes, generated `dist/` matches source, and `pnpm audit:public:history` reports only approved noreply/example identities.
