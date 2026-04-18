export function selectLatestGitHubRelease(releases, { includePrereleases = false } = {}) {
  const release = (releases ?? []).find((entry) => {
    if (!entry || entry.draft) {
      return false;
    }
    if (!includePrereleases && entry.prerelease) {
      return false;
    }
    return true;
  });
  if (!release) {
    throw new Error(`no ${includePrereleases ? "" : "stable "}releases found`.trim());
  }
  return release;
}
