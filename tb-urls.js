const ROSTER_JSON = /^https:\/\/cdn\.mcr\.ea\.com\/\d+\/bundles-users\/[^/]+\/[^/]+\/[^/]*nonce-primary\.json(?:[?#].*)?$/i;

const TEAM_PAGE = /\/team-builder\/(?:team-create\/[a-z-]+|preview)\/([^/?#]+)/i;

const TEAM_BUILDER_PAGE = /^https:\/\/www\.ea\.com\/[^?#]*\/team-builder(?:[/?#]|$)/i;

const EA_CDN = /^https:\/\/cdn\.mcr\.ea\.com\//i;

const EA_STATIC = /^https:\/\/q\.mcr\.ea\.com\/r\/\d+\/file\//i;

const DEBUGGER_PATTERN = "https://cdn.mcr.ea.com/*/bundles-users/*/*/*nonce-primary.json*";

const TEAM_BUILDER_MATCH = "https://www.ea.com/games/madden-nfl/team-builder/*";
