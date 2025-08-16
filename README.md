# ChromeTabOverflow

A Node.js toolkit for managing Chrome tab overload using markdown exports and AI analysis.

<img width="1150" height="590" alt="image" src="https://github.com/user-attachments/assets/d69ef7df-9fcb-415f-b5f8-9b748945a2a3" />


## Problem

Having hundreds of open Chrome tabs across multiple windows makes it difficult to find content, impacts browser performance, and reduces productivity. Manually organizing tabs is time-consuming and organizing strategies often fail as new tabs accumulate.

## Solution

ChromeTabOverflow provides four command-line tools that work together:

- **ChromeDump**: Extracts all Chrome tabs from all windows and exports to markdown, optionally with AI-generated summaries
- **ChromeKeep**: Compares open tabs against saved markdown files and closes tabs not present in the saved list
- **ChromeRecommend**: Analyzes tab patterns using GPT-5 and generates reorganization recommendations
- **ChromeReorg**: Executes reorganization plans by automatically moving tabs between windows using AppleScript

## Basic fast usage without AI

```bash
# npm install # if first time

# quickly dump all your open tabs
npm run fast

# manually open up the generated .md file and delete urls in the .md file
# do it

# close the tabs you deleted in the markdown file
npm run keep-latest
```

then after the fast pass, if you want a reading run where you get summaries of every url with `gpt-5-nano`

```bash
# have OPENAI_API_KEY
npm run dump
```

## Features

### `npm run fast` (or `npm run dump` to fast + summarize)
- Extracts Chrome tabs from all windows using macOS automation
- Fast mode for instant tab dump without content processing
- Content reading via Jina.ai (first 30k words per tab) 
- AI summaries using OpenAI GPT-5-nano
- Sequential processing with rate limiting and error handling
- Real-time progress tracking
- Markdown export with clickable links and summaries

### `npm run keep <file.md>` or `npm run keep-latest`
- Parses URLs from markdown files (both markdown links and bare URLs)
- Compares open tabs against saved URLs
- Interactive multiselect interface for tab review
- Safe tab closing with confirmation prompts
- Processes tabs individually to handle index changes
- Batch processing for large tab counts to avoid command line limits

### `npm run recommend <file.md>` or `npm run recommend-latest`
- AI-powered analysis using GPT-5 with chain of thought reasoning
- Pattern recognition for domains, topics, and work contexts
- Smart grouping suggestions for logical window organization
- Structured recommendations with actionable steps
- Detailed reports with reorganization plans
- Optimizations for workflow efficiency and reduced context switching

### `npm run reorg`
- Automated execution of reorganization plans using AppleScript
- Window management - creates new windows and moves tabs between them
- Uses GPT-5 to generate fresh reorganization instructions based on current tab state
- Handles tab changes since original recommendations were made
- Safe execution with preview and confirmation requirements
- URL-based tab matching for accuracy

## Installation

```bash
npm install
```

## Environment Variables

### Setup Options

**Option 1: Use .env file (Recommended)**
```bash
# Copy the example file
cp .env.example .env

# Edit .env file with your API keys
nano .env
```

**Option 2: Export manually**
```bash
export OPENAI_API_KEY=sk-proj-your-openai-key-here
```

### Required
- `OPENAI_API_KEY`: OpenAI API key for generating summaries (ChromeDump full mode), reorganization recommendations (ChromeRecommend), and reorganization instructions (ChromeReorg). Not needed for ChromeDump fast mode or ChromeKeep.

## Performance

### Rate Limits
- Jina.ai free tier: 1 concurrent request, 20 requests per minute
- OpenAI Tier 1: 5 concurrent requests, 500 requests per minute
- Smart filtering skips 30-50% of tabs (domains, file types, short content)
- Content processing limited to 30k words per tab

### Processing Time (200 tabs example)
- Extract tabs: ~10 seconds
- Fast dump creation: ~1 second
- Read content: ~10 minutes (50% tabs skipped, 100 remaining tabs × 3.5s average response time)
- Generate summaries: ~2 minutes (80 tabs with substantial content ÷ 5 concurrent × 5.5s average response time)
- Generate full export: ~2 seconds

Total: 12-15 minutes for 200 tabs (fast dump available in 11 seconds)

## Usage

### ChromeDump
Export all tabs with AI summaries:
```bash
# Fast mode - instant tab dump without content/AI processing!!! try this first!
npm run fast

# fast dump + summarize usage (requires OPENAI_API_KEY in .env)
npm run dump

# Or set environment variable inline
OPENAI_API_KEY=your_key npm run dump

# Or directly with flag
node chromedump.js --fast
```

### ChromeKeep
Compare and clean up tabs against a markdown file:
```bash
# Using npm script with specific file
npm run keep your-saved-tabs.md

# Or use the latest created .md file automatically
npm run keep-latest

# Or directly
node chromekeep.js your-saved-tabs.md
```

### ChromeRecommend
Analyze tab patterns and get AI reorganization recommendations:
```bash
# Analyze specific chromedump file (requires OPENAI_API_KEY)
npm run recommend open-tabs-fast-2025-08-14T20-33-43-477Z.md

# Or analyze the latest chromedump file automatically
npm run recommend-latest

# Or directly
node chromerecommend.js your-chromedump-file.md
```

### ChromeReorg
Execute approved reorganization plans automatically:
```bash
# Execute reorganization from recommendations file
npm run reorg chrome-organization-recommendations-2025-08-14T20-34-03-918Z.md

# Or directly
node chromereorg.js your-recommendations-file.md
```

**ChromeKeep Workflow:**
1. Reads URLs from your markdown file
2. Gets all open Chrome tabs
3. Identifies tabs not saved in markdown
4. Shows multiselect list (all pre-selected)
5. Confirms before closing selected tabs

**Complete Workflow:**
```bash
# 1. Export current tabs
npm run fast

# 2. Get reorganization recommendations  
npm run recommend-latest

# 3. Execute reorganization
npm run reorg chrome-organization-recommendations-*.md

# 4. Clean up remaining tabs
npm run keep-latest
```

**Quick Analysis:**
```bash
npm run fast && npm run recommend-latest
```

## Output Format

### ChromeDump
Generates two timestamped markdown files:

1. Fast Dump (`open-tabs-fast-TIMESTAMP.md`) - Tab titles and URLs only
2. Full Export (`open-tabs-TIMESTAMP.md`) - Includes AI summaries

Fast dump format:
```markdown
# Chrome Tabs Fast Dump - 8/14/2025, 11:45:00 AM

192 tabs across 21 windows

## Window 1 (11 tabs)

- [Tab Title](https://example.com) (domain.com)
- [Another Tab](https://example2.com) (domain2.com)
```

Full export format:
```markdown
# Chrome Tabs Export - 8/14/2025, 11:45:00 AM

192 tabs across 21 windows
- Content read: 145 tabs  
- Summaries generated: 145 tabs

- Window 1 (11 tabs)
    - [Tab Title](https://example.com) (domain.com) - AI-generated summary
    - [Another Tab](https://example2.com) (domain2.com) - Another summary
```

### ChromeKeep
Interactive CLI output only - closes selected tabs, no file output.

### ChromeRecommend
Generates timestamped analysis report (`chrome-organization-recommendations-TIMESTAMP.md`):

```markdown
# Chrome Tab Organization Recommendations
Generated: 8/14/2025, 8:34:03 PM
Source: open-tabs-fast-2025-08-14T20-33-43-477Z.md
Total tabs: 89 across 15 windows

## AI Analysis
[Chain of thought reasoning about current tab organization patterns]

## Structured Recommendations

### Current State Analysis
Current Organization: Brief assessment of existing window structure
Main Issues:
- Too many scattered tabs
- Mixed contexts in single windows

### Recommended Window Organization
1. Development & Documentation
   Purpose: Coding resources and API docs
   Estimated tabs: 25
   Priority: high

### Specific Actions
1. CREATE NEW WINDOW
   - Description: Group all GitHub and documentation tabs
   - Benefit: Reduces context switching during development
```

### ChromeReorg
CLI output only - executes reorganization by modifying Chrome directly, no file output.

## Requirements

- macOS (uses AppleScript for Chrome automation)
- Google Chrome running
- Node.js
- OpenAI API key (ChromeDump full mode and ChromeRecommend, not needed for ChromeDump `--fast` mode, ChromeKeep, or ChromeReorg)

## Permissions

You may need to grant permission for Terminal/iTerm to control Chrome:
- System Preferences → Security & Privacy → Privacy → Automation
- Allow your terminal app to control Google Chrome

## Error Handling

- Automatic retries with exponential backoff for rate limits
- Fallback handling for failed content reads
- Individual tab processing to handle Chrome state changes
- Graceful handling of inaccessible or closed tabs
- AppleScript command line limit avoidance through batch processing
- Real-time index tracking to handle tab movements during processing

## Notes

ChromeReorg generates fresh reorganization instructions using GPT-5 by analyzing current tab state against previous recommendations, ensuring accuracy even if tabs have changed since initial analysis.

Processing time scales with tab count and content complexity. Fast mode provides immediate access to tab lists!
