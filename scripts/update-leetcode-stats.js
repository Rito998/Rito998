// scripts/update-leetcode-stats.js
//
// Pulls REAL public stats for a LeetCode username from LeetCode's own
// GraphQL API (the same one leetcode.com uses), then:
//   1. Injects a markdown stats block into README.md between marker comments
//   2. Generates a standalone SVG "stats card" at assets/leetcode-stats.svg
//
// This does not solve problems or fabricate activity — it only reflects
// whatever you've actually solved on LeetCode.

const fs = require("fs");
const path = require("path");

const USERNAME = process.env.LEETCODE_USERNAME || "Rito998";
const README_PATH = path.join(process.cwd(), "README.md");
const SVG_PATH = path.join(process.cwd(), "assets", "leetcode-stats.svg");

const START_TAG = "<!--LEETCODE_STATS_START-->";
const END_TAG = "<!--LEETCODE_STATS_END-->";

const QUERY = `
  query getUserProfile($username: String!) {
    matchedUser(username: $username) {
      username
      submitStats: submitStatsGlobal {
        acSubmissionNum {
          difficulty
          count
        }
      }
      profile {
        ranking
      }
    }
    userContestRanking(username: $username) {
      attendedContestsCount
      rating
      globalRanking
      topPercentage
    }
    recentAcSubmissionList(username: $username, limit: 5) {
      title
      titleSlug
      timestamp
    }
  }
`;

async function fetchLeetCodeData(username) {
  const res = await fetch("https://leetcode.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // LeetCode's GraphQL endpoint applies bot-detection that can 403
      // requests missing a browser-like Referer/User-Agent (common on
      // CI runners) — these headers keep it working from GitHub Actions.
      Referer: `https://leetcode.com/${username}/`,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    },
    body: JSON.stringify({ query: QUERY, variables: { username } }),
  });

  if (!res.ok) {
    throw new Error(`LeetCode API request failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`LeetCode API error: ${JSON.stringify(json.errors)}`);
  }
  if (!json.data || !json.data.matchedUser) {
    throw new Error(`No LeetCode user found for username "${username}"`);
  }
  return json.data;
}

function extractCounts(acSubmissionNum) {
  const find = (d) => acSubmissionNum.find((s) => s.difficulty === d)?.count || 0;
  const easy = find("Easy");
  const medium = find("Medium");
  const hard = find("Hard");
  return {
    easy,
    medium,
    hard,
    // LeetCode's own "All" field can lag a few minutes behind the per-difficulty
    // counts right after a new solve, so we derive the total ourselves instead
    // of trusting it directly — this keeps the header total and the table rows
    // always consistent with each other.
    total: easy + medium + hard,
  };
}

function buildMarkdownBlock(data) {
  const counts = extractCounts(data.matchedUser.submitStats.acSubmissionNum);
  const ranking = data.matchedUser.profile.ranking;
  const recent = data.recentAcSubmissionList || [];
  const contest = data.userContestRanking;

  const recentLines = recent.length
    ? recent
        .map((r) => `- [${r.title}](https://leetcode.com/problems/${r.titleSlug}/)`)
        .join("\n")
    : "_No recent accepted submissions found._";

  const contestLine = contest
    ? `**Contest Rating:** ${Math.round(contest.rating)} (top ${contest.topPercentage?.toFixed(2)}%, ${contest.attendedContestsCount} contests attended)\n\n`
    : "";

  return `${START_TAG}
## 📊 LeetCode Progress

![LeetCode Stats](./assets/leetcode-stats.svg)

**Total Solved:** ${counts.total} &nbsp;|&nbsp; **Global Ranking:** #${ranking ? ranking.toLocaleString() : "N/A"}

${contestLine}| Difficulty | Solved |
|---|---|
| 🟢 Easy | ${counts.easy} |
| 🟡 Medium | ${counts.medium} |
| 🔴 Hard | ${counts.hard} |

**Recently Solved**
${recentLines}

_Last updated: ${new Date().toISOString().split("T")[0]} · via [LeetCode public API](https://leetcode.com/${USERNAME}/)_
${END_TAG}`;
}

function updateReadme(block) {
  let readme = "";
  if (fs.existsSync(README_PATH)) {
    readme = fs.readFileSync(README_PATH, "utf8");
  }

  if (readme.includes(START_TAG) && readme.includes(END_TAG)) {
    const before = readme.split(START_TAG)[0];
    const after = readme.split(END_TAG)[1];
    readme = `${before}${block}${after}`;
  } else {
    readme = readme.trimEnd() + (readme ? "\n\n" : "") + block + "\n";
  }

  fs.writeFileSync(README_PATH, readme);
  console.log("README.md updated.");
}

function buildBar(count, max, width) {
  if (max <= 0) return 0;
  return Math.max(2, Math.round((count / max) * width));
}

function buildSvg(data) {
  const counts = extractCounts(data.matchedUser.submitStats.acSubmissionNum);
  const ranking = data.matchedUser.profile.ranking;

  const width = 480;
  const height = 200;
  const barMaxWidth = 260;
  const maxCount = Math.max(counts.easy, counts.medium, counts.hard, 1);

  const barsData = [
    { label: "Easy", count: counts.easy, color: "#2ea44f", y: 96 },
    { label: "Medium", count: counts.medium, color: "#e3a008", y: 126 },
    { label: "Hard", count: counts.hard, color: "#e5534b", y: 156 },
  ];

  const bars = barsData
    .map((b) => {
      const barWidth = buildBar(b.count, maxCount, barMaxWidth);
      return `
        <text x="24" y="${b.y + 5}" font-size="13" fill="#8a8fa3" font-family="Segoe UI, sans-serif">${b.label}</text>
        <rect x="90" y="${b.y - 10}" width="${barMaxWidth}" height="14" rx="7" fill="#262a36" />
        <rect x="90" y="${b.y - 10}" width="${barWidth}" height="14" rx="7" fill="${b.color}" />
        <text x="${90 + barMaxWidth + 12}" y="${b.y + 2}" font-size="13" fill="#e8eaf0" font-family="Segoe UI, sans-serif" font-weight="600">${b.count}</text>
      `;
    })
    .join("");

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" rx="14" fill="#0f1117" stroke="#262a36" />
  <text x="24" y="34" font-size="18" font-weight="700" fill="#e8eaf0" font-family="Segoe UI, sans-serif">LeetCode Progress — ${USERNAME}</text>
  <text x="24" y="58" font-size="13" fill="#8a8fa3" font-family="Segoe UI, sans-serif">Total solved: ${counts.total} &#183; Global rank #${ranking ? ranking.toLocaleString() : "N/A"}</text>
  ${bars}
</svg>`;
}

function writeSvg(svg) {
  fs.mkdirSync(path.dirname(SVG_PATH), { recursive: true });
  fs.writeFileSync(SVG_PATH, svg);
  console.log("assets/leetcode-stats.svg updated.");
}

async function main() {
  console.log(`Fetching LeetCode stats for "${USERNAME}"...`);
  const data = await fetchLeetCodeData(USERNAME);

  const markdownBlock = buildMarkdownBlock(data);
  updateReadme(markdownBlock);

  const svg = buildSvg(data);
  writeSvg(svg);
}

main().catch((err) => {
  console.error("Failed to update LeetCode stats:", err.message);
  process.exit(1);
});
