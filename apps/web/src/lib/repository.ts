/**
 * Where the software itself lives. These are plain links: nothing in the app requests GitHub on
 * load, a visit happens only when someone opens one. An instance run by someone else points here
 * too, so the copy next to them says what GitHub is for and what the instance's contact is for.
 */
export const REPO_URL = "https://github.com/kim0040/gachipad";
/** New issue: the repository has no issue templates, so this opens a blank one. */
export const REPO_ISSUE_URL = `${REPO_URL}/issues/new`;
export const REPO_CONTRIBUTING_URL = `${REPO_URL}/blob/main/CONTRIBUTING.md`;
