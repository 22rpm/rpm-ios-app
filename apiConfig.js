// Single source of truth for the device-data API base.
//
// FLIP THIS ONE LINE TO PRODUCTION BEFORE SHIPPING. A release build must not
// contain a 192.168.* host (see RELEASE_HOTFIX.md); `grep -rn "192.168"` over the
// release worktree must return nothing. Centralized here so there is exactly one
// place to change, instead of a URL duplicated across screens.
export const DEV_DATA_BASE = 'http://192.168.1.15:4000/api/dev-data';
// Production: 'https://rmtrpm.duckdns.org/rpm-be/api/dev-data'
