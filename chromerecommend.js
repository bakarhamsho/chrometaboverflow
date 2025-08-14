#!/usr/bin/env node

require('dotenv').config();

const fs = require('fs');
const OpenAI = require('openai');

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Function to parse markdown file and extract tab data
function parseMarkdownTabs(markdownContent) {
    const windows = [];
    let currentWindow = null;
    
    const lines = markdownContent.split('\n');
    
    for (const line of lines) {
        // Match window headers like "## Window 1 (11 tabs)" or "- **Window 1** (11 tabs)"
        const windowMatch = line.match(/^##?\s*(?:\*\*)?Window (\d+)(?:\*\*)?\s*\((\d+) tabs?\)/i) ||
                           line.match(/^-?\s*\*\*Window (\d+)\*\*\s*\((\d+) tabs?\)/i);
        
        if (windowMatch) {
            if (currentWindow) {
                windows.push(currentWindow);
            }
            currentWindow = {
                windowIndex: parseInt(windowMatch[1]),
                tabCount: parseInt(windowMatch[2]),
                tabs: []
            };
            continue;
        }
        
        // Match tab entries like "- [Title](url) (domain) - Summary" or "    - [Title](url) (domain) - Summary"
        const tabMatch = line.match(/^\s*-\s*\[([^\]]+)\]\(([^)]+)\)\s*\(([^)]+)\)(?:\s*-\s*(.+))?/);
        
        if (tabMatch && currentWindow) {
            const [, title, url, domain, summary] = tabMatch;
            currentWindow.tabs.push({
                title: title.trim(),
                url: url.trim(),
                domain: domain.trim(),
                summary: summary ? summary.trim() : null
            });
        }
    }
    
    if (currentWindow) {
        windows.push(currentWindow);
    }
    
    return windows;
}

// Function to analyze tabs and get reorganization recommendations
async function getReorganizationRecommendations(windows) {
    console.log('🤖 Analyzing tabs with GPT-5 for reorganization recommendations...');
    
    // Prepare tab data for analysis
    const tabAnalysis = windows.map(window => {
        return {
            windowIndex: window.windowIndex,
            tabCount: window.tabs.length,
            tabs: window.tabs.map(tab => ({
                title: tab.title,
                url: tab.url,
                domain: tab.domain,
                summary: tab.summary
            }))
        };
    });
    
    const totalTabs = windows.reduce((sum, w) => sum + w.tabs.length, 0);
    
    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-5',
            messages: [
                {
                    role: 'system',
                    content: `You are a productivity expert who helps users organize their browser tabs efficiently. You will analyze Chrome browser tabs across multiple windows and provide structured recommendations for reorganizing them into logical groups.

Your task is to:
1. Think through the tab patterns and relationships step by step
2. Identify natural groupings based on domains, topics, work contexts, etc.
3. Provide specific, actionable recommendations for window organization

Use chain of thought reasoning to analyze the patterns, then provide structured output.`
                },
                {
                    role: 'user',
                    content: `Please analyze these Chrome tabs across ${windows.length} windows (${totalTabs} total tabs) and provide reorganization recommendations.

Current tab organization:
${JSON.stringify(tabAnalysis, null, 2)}

Please provide:
1. Chain of thought analysis of the current tab patterns
2. Structured recommendations for reorganizing into logical windows
3. Specific suggestions for which tabs to group together and why

Focus on practical productivity improvements like grouping by:
- Gneeral personal (personal vs work vs side projects)
- distinguish between different Work projects/contexts
- Research topics
- Social media/entertainment
- Tools/utilities
- Shopping/commerce
- Documentation/references
etc.`
                }
            ],
            // temperature: 0.3
        });
        
        return response.choices[0]?.message?.content || 'No recommendations generated';
        
    } catch (error) {
        console.error('❌ Error getting AI recommendations:', error.message);
        throw error;
    }
}

// Function to generate structured recommendations with actionable steps
async function getStructuredRecommendations(windows) {
    console.log('📋 Generating structured reorganization plan...');
    
    const tabAnalysis = windows.map(window => ({
        windowIndex: window.windowIndex,
        tabCount: window.tabs.length,
        domains: [...new Set(window.tabs.map(tab => tab.domain))],
        tabs: window.tabs.map(tab => ({
            title: tab.title,
            domain: tab.domain,
            category: categorizeTab(tab)
        }))
    }));
    
    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                {
                    role: 'system',
                    content: `You are a browser productivity expert. Analyze the provided tabs and create a structured reorganization plan.

Return your response as a JSON object with this exact structure:
{
  "analysis": {
    "current_state": "Brief description of current organization",
    "main_issues": ["Issue 1", "Issue 2", ...],
    "identified_patterns": ["Pattern 1", "Pattern 2", ...]
  },
  "recommended_windows": [
    {
      "window_name": "Descriptive name for this window group",
      "purpose": "What this window is for",
      "tab_domains": ["domain1.com", "domain2.com", ...],
      "estimated_tab_count": number,
      "priority": "high|medium|low"
    }
  ],
  "specific_actions": [
    {
      "action": "create_new_window|move_tabs|close_duplicates",
      "description": "What to do",
      "tabs_affected": ["domain1.com", "domain2.com", ...],
      "reason": "Why this helps productivity"
    }
  ],
  "productivity_benefits": [
    "Benefit 1",
    "Benefit 2",
    ...
  ]
}`
                },
                {
                    role: 'user',
                    content: `Analyze these ${windows.length} Chrome windows with ${windows.reduce((sum, w) => sum + w.tabs.length, 0)} total tabs:

${JSON.stringify(tabAnalysis, null, 2)}

Provide a structured reorganization plan as JSON.`
                }
            ],
            temperature: 0.2
        });
        
        const content = response.choices[0]?.message?.content || '{}';
        
        // Try to parse JSON, fall back to text if it fails
        try {
            return JSON.parse(content);
        } catch (parseError) {
            return { raw_response: content };
        }
        
    } catch (error) {
        console.error('❌ Error getting structured recommendations:', error.message);
        throw error;
    }
}

// Simple categorization helper
function categorizeTab(tab) {
    const domain = tab.domain.toLowerCase();
    const title = tab.title.toLowerCase();
    
    // Work/Productivity
    if (domain.includes('slack') || domain.includes('notion') || domain.includes('trello') || 
        domain.includes('asana') || domain.includes('zoom') || domain.includes('teams')) {
        return 'work';
    }
    
    // Development
    if (domain.includes('github') || domain.includes('stackoverflow') || domain.includes('docs') ||
        title.includes('api') || title.includes('documentation')) {
        return 'development';
    }
    
    // Social/Entertainment
    if (domain.includes('twitter') || domain.includes('facebook') || domain.includes('instagram') ||
        domain.includes('youtube') || domain.includes('tiktok') || domain.includes('reddit')) {
        return 'social';
    }
    
    // Shopping
    if (domain.includes('amazon') || domain.includes('ebay') || domain.includes('shop') ||
        title.includes('cart') || title.includes('checkout')) {
        return 'shopping';
    }
    
    // News/Reading
    if (domain.includes('news') || domain.includes('medium') || domain.includes('blog') ||
        domain.includes('article')) {
        return 'reading';
    }
    
    return 'general';
}

async function main() {
    try {
        // Check for OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.error('❌ Error: OPENAI_API_KEY environment variable is required');
            console.error('💡 Set it with: export OPENAI_API_KEY=your_api_key_here');
            process.exit(1);
        }
        
        // Check if markdown filename argument is provided
        const markdownFile = process.argv[2];
        if (!markdownFile) {
            console.error('❌ Error: Please provide a markdown filename as the first argument');
            console.error('💡 Usage: node chromeorganize.js <chromedump-output.md>');
            console.error('💡 Example: node chromeorganize.js open-tabs-2025-08-14T20-13-44-130Z.md');
            process.exit(1);
        }
        
        // Check if the markdown file exists
        if (!fs.existsSync(markdownFile)) {
            console.error(`❌ Error: Markdown file '${markdownFile}' not found`);
            process.exit(1);
        }
        
        console.log('🚀 Chrome Tab Organization Analyzer');
        console.log(`📄 Analyzing: ${markdownFile}\n`);
        
        // Read and parse markdown file
        console.log('📖 Reading tab data from markdown file...');
        const markdownContent = fs.readFileSync(markdownFile, 'utf8');
        const windows = parseMarkdownTabs(markdownContent);
        
        if (windows.length === 0) {
            console.error('❌ No windows/tabs found in markdown file');
            console.error('💡 Make sure the file is a valid chromedump output');
            process.exit(1);
        }
        
        const totalTabs = windows.reduce((sum, w) => sum + w.tabs.length, 0);
        console.log(`✅ Parsed ${totalTabs} tabs across ${windows.length} windows`);
        
        // Show current organization
        console.log('\n📊 Current organization:');
        windows.forEach(window => {
            const domains = [...new Set(window.tabs.map(tab => tab.domain))];
            console.log(`   Window ${window.windowIndex}: ${window.tabs.length} tabs, ${domains.length} domains`);
        });
        
        // Get AI recommendations
        console.log('\n🤖 Getting AI analysis and recommendations...');
        
        // Get both narrative and structured recommendations
        const [narrative, structured] = await Promise.all([
            getReorganizationRecommendations(windows),
            getStructuredRecommendations(windows)
        ]);
        
        // Generate output file
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const outputFile = `chrome-organization-recommendations-${timestamp}.md`;
        
        let output = `# Chrome Tab Organization Recommendations\n`;
        output += `Generated: ${new Date().toLocaleString()}\n`;
        output += `Source: ${markdownFile}\n`;
        output += `Total tabs: ${totalTabs} across ${windows.length} windows\n\n`;
        
        // Add narrative analysis
        output += `## AI Analysis\n\n${narrative}\n\n`;
        
        // Add structured recommendations if available
        if (structured.analysis) {
            output += `## Structured Recommendations\n\n`;
            
            output += `### Current State Analysis\n`;
            output += `**Current Organization:** ${structured.analysis.current_state}\n\n`;
            
            if (structured.analysis.main_issues) {
                output += `**Main Issues:**\n`;
                structured.analysis.main_issues.forEach(issue => {
                    output += `- ${issue}\n`;
                });
                output += `\n`;
            }
            
            if (structured.analysis.identified_patterns) {
                output += `**Identified Patterns:**\n`;
                structured.analysis.identified_patterns.forEach(pattern => {
                    output += `- ${pattern}\n`;
                });
                output += `\n`;
            }
            
            if (structured.recommended_windows) {
                output += `### Recommended Window Organization\n\n`;
                structured.recommended_windows.forEach((window, index) => {
                    output += `#### ${index + 1}. ${window.window_name}\n`;
                    output += `**Purpose:** ${window.purpose}\n`;
                    output += `**Estimated tabs:** ${window.estimated_tab_count}\n`;
                    output += `**Priority:** ${window.priority}\n`;
                    if (window.tab_domains) {
                        output += `**Key domains:** ${window.tab_domains.join(', ')}\n`;
                    }
                    output += `\n`;
                });
            }
            
            if (structured.specific_actions) {
                output += `### Specific Actions\n\n`;
                structured.specific_actions.forEach((action, index) => {
                    output += `${index + 1}. **${action.action.replace(/_/g, ' ').toUpperCase()}**\n`;
                    output += `   - Description: ${action.description}\n`;
                    if (action.tabs_affected) {
                        output += `   - Affects: ${action.tabs_affected.join(', ')}\n`;
                    }
                    output += `   - Benefit: ${action.reason}\n\n`;
                });
            }
            
            if (structured.productivity_benefits) {
                output += `### Expected Productivity Benefits\n\n`;
                structured.productivity_benefits.forEach(benefit => {
                    output += `- ${benefit}\n`;
                });
                output += `\n`;
            }
        }
        
        // Add current window details for reference
        output += `## Current Window Details (for reference)\n\n`;
        windows.forEach(window => {
            output += `### Window ${window.windowIndex} (${window.tabs.length} tabs)\n`;
            const domainGroups = {};
            window.tabs.forEach(tab => {
                if (!domainGroups[tab.domain]) domainGroups[tab.domain] = [];
                domainGroups[tab.domain].push(tab.title);
            });
            
            Object.keys(domainGroups).forEach(domain => {
                output += `**${domain}** (${domainGroups[domain].length} tabs):\n`;
                domainGroups[domain].forEach(title => {
                    output += `  - ${title}\n`;
                });
            });
            output += `\n`;
        });
        
        // Write output file
        fs.writeFileSync(outputFile, output, 'utf8');
        
        console.log(`\n🎉 Analysis complete!`);
        console.log(`📄 Recommendations saved to: ${outputFile}`);
        console.log(`📊 Analyzed ${totalTabs} tabs across ${windows.length} windows`);
        
        // Show quick summary
        if (structured.recommended_windows) {
            console.log(`\n📋 Quick Summary:`);
            console.log(`   Current: ${windows.length} windows`);
            console.log(`   Recommended: ${structured.recommended_windows.length} windows`);
            console.log(`   Priority actions: ${structured.specific_actions?.filter(a => a.priority === 'high')?.length || 'N/A'}`);
        }
        
    } catch (error) {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    }
}

// Handle command line execution
if (require.main === module) {
    main().catch(console.error);
}

module.exports = {
    parseMarkdownTabs,
    getReorganizationRecommendations,
    getStructuredRecommendations,
    main
};