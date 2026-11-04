export const branchSelectionQuery = `query RunBranches($owner: String!, $repo: String!, $after: String) {
  repository(owner: $owner, name: $repo) {
    defaultBranchRef { name }
    refs(refPrefix: "refs/heads/", first: 100, after: $after) {
      nodes { name target { ... on Commit { committedDate messageHeadline } } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;
