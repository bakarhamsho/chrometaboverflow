#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');

// Import tab extraction function from chromekeep
const { extractChromeTabs } = require('./chromekeep');

// Function to parse recommendations from markdown file
function parseRecommendationsFile(markdownContent) {
    const recommendations = {
        recommended_windows: [],
        specific_actions: []
    };
    
    const lines = markdownContent.split('\n');
    let currentSection = null;
    let currentWindow = null;
    let currentAction = null;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Look for JSON sections in the markdown
        if (line.includes('"recommended_windows"') || line.includes('"specific_actions"')) {
            // Try to find and parse JSON blocks
            const jsonStart = markdownContent.indexOf('{', markdownContent.indexOf(line));
            if (jsonStart !== -1) {
                // Find matching closing brace
                let braceCount = 0;
                let jsonEnd = jsonStart;
                for (let j = jsonStart; j < markdownContent.length; j++) {
                    if (markdownContent[j] === '{') braceCount++;
                    if (markdownContent[j] === '}') braceCount--;
                    if (braceCount === 0) {
                        jsonEnd = j;
                        break;
                    }
                }
                
                try {
                    const jsonStr = markdownContent.substring(jsonStart, jsonEnd + 1);
                    const parsed = JSON.parse(jsonStr);
                    if (parsed.recommended_windows) recommendations.recommended_windows = parsed.recommended_windows;
                    if (parsed.specific_actions) recommendations.specific_actions = parsed.specific_actions;
                } catch (error) {
                    // Ignore JSON parse errors, continue with text parsing
                }
            }
        }
        
        // Parse window recommendations from text format
        if (line.match(/^\d+\.\s*\*\*(.+)\*\*$/)) {
            const windowName = line.match(/^\d+\.\s*\*\*(.+)\*\*$/)[1];
            currentWindow = {
                window_name: windowName,
                purpose: '',
                tab_domains: [],
                estimated_tab_count: 0,
                priority: 'medium'
            };
            recommendations.recommended_windows.push(currentWindow);
        }
        
        if (currentWindow) {
            if (line.startsWith('**Purpose:**')) {
                currentWindow.purpose = line.replace('**Purpose:**', '').trim();
            } else if (line.startsWith('**Estimated tabs:**')) {
                const count = line.match(/\d+/);
                if (count) currentWindow.estimated_tab_count = parseInt(count[0]);
            } else if (line.startsWith('**Priority:**')) {
                currentWindow.priority = line.replace('**Priority:**', '').trim();
            } else if (line.startsWith('**Key domains:**')) {
                const domains = line.replace('**Key domains:**', '').trim();
                currentWindow.tab_domains = domains.split(',').map(d => d.trim());
            }
        }
    }
    
    return recommendations;
}

// Function to match tabs by domain patterns
function matchTabsByDomains(currentTabs, domains) {
    const matchedTabs = [];
    
    for (const tab of currentTabs) {
        try {
            const tabDomain = new URL(tab.url).hostname.toLowerCase();
            
            for (const domain of domains) {
                const domainPattern = domain.toLowerCase();
                if (tabDomain === domainPattern || 
                    tabDomain.endsWith('.' + domainPattern) ||
                    tabDomain.includes(domainPattern)) {
                    matchedTabs.push(tab);
                    break;
                }
            }
        } catch (error) {
            // Skip invalid URLs
        }
    }
    
    return matchedTabs;
}

// Function to execute reorganization plan
async function executeReorganization(recommendations, currentTabs) {
    if (!recommendations.recommended_windows || recommendations.recommended_windows.length === 0) {
        console.log('❌ No window recommendations found in file');
        return;
    }
    
    console.log('🔍 Analyzing current tabs and recommendations...\n');
    
    // Show what will be reorganized
    const reorganizationPlan = [];
    
    for (let i = 0; i < recommendations.recommended_windows.length; i++) {
        const windowRec = recommendations.recommended_windows[i];
        const matchedTabs = matchTabsByDomains(currentTabs, windowRec.tab_domains || []);
        
        if (matchedTabs.length > 0) {
            reorganizationPlan.push({
                windowName: windowRec.window_name,
                purpose: windowRec.purpose,
                priority: windowRec.priority,
                tabs: matchedTabs,
                isNewWindow: i > 0 // First window can reuse existing, others are new
            });
            
            console.log(`📋 ${windowRec.window_name}`);
            console.log(`   Purpose: ${windowRec.purpose}`);
            console.log(`   Priority: ${windowRec.priority}`);
            console.log(`   Matched tabs: ${matchedTabs.length}`);
            matchedTabs.forEach(tab => {
                console.log(`     • ${tab.title.substring(0, 60)}... (${new URL(tab.url).hostname})`);
            });
            console.log('');
        }
    }
    
    if (reorganizationPlan.length === 0) {
        console.log('❌ No tabs matched the recommended domains');
        return;
    }
    
    // Confirm execution
    const confirmAnswer = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'confirmReorg',
            message: `Execute this reorganization plan? This will create ${reorganizationPlan.filter(p => p.isNewWindow).length} new windows and move ${reorganizationPlan.reduce((sum, p) => sum + p.tabs.length, 0)} tabs.`,
            default: false
        }
    ]);
    
    if (!confirmAnswer.confirmReorg) {
        console.log('❌ Reorganization cancelled');
        return;
    }
    
    console.log('🔄 Executing reorganization plan...\n');
    
    // Execute the reorganization
    let movedTabsCount = 0;
    let createdWindowsCount = 0;
    
    for (let planIndex = 0; planIndex < reorganizationPlan.length; planIndex++) {
        const plan = reorganizationPlan[planIndex];
        
        console.log(`⏳ Processing: ${plan.windowName}...`);
        
        try {
            let targetWindowId;
            
            if (plan.isNewWindow) {
                // Create new window
                console.log(`   🪟 Creating new window...`);
                
                const createWindowScript = `
                    tell application "Google Chrome"
                        set newWindow to make new window
                        return id of newWindow
                    end tell
                `;
                
                const tempScriptPath = path.join(process.cwd(), 'temp_create_window.scpt');
                fs.writeFileSync(tempScriptPath, createWindowScript, 'utf8');
                
                try {
                    const result = execSync(`osascript "${tempScriptPath}"`, { encoding: 'utf8' });
                    targetWindowId = result.trim();
                    createdWindowsCount++;
                } finally {
                    try {
                        fs.unlinkSync(tempScriptPath);
                    } catch (cleanupError) {
                        // Ignore cleanup errors
                    }
                }
            } else {
                // Use existing window (first window)
                targetWindowId = '1';
            }
            
            // Move tabs to the target window
            for (let tabIndex = 0; tabIndex < plan.tabs.length; tabIndex++) {
                const tab = plan.tabs[tabIndex];
                
                try {
                    console.log(`   📋 Moving: ${tab.title.substring(0, 50)}...`);
                    
                    // Re-read current tabs to get fresh indices (tabs shift as we move them)
                    const freshTabs = await extractChromeTabs();
                    const currentTab = freshTabs.find(t => t.url === tab.url);
                    
                    if (!currentTab) {
                        console.log(`   ⚠️  Tab no longer found: ${tab.url}`);
                        continue;
                    }
                    
                    if (plan.isNewWindow) {
                        // Move tab to new window
                        const moveScript = `
                            tell application "Google Chrome"
                                move tab ${currentTab.tabIndex} of window ${currentTab.windowIndex} to end of window ${targetWindowId}
                            end tell
                        `;
                        
                        const tempScriptPath = path.join(process.cwd(), 'temp_move_tab.scpt');
                        fs.writeFileSync(tempScriptPath, moveScript, 'utf8');
                        
                        try {
                            execSync(`osascript "${tempScriptPath}"`, { encoding: 'utf8' });
                            movedTabsCount++;
                        } finally {
                            try {
                                fs.unlinkSync(tempScriptPath);
                            } catch (cleanupError) {
                                // Ignore cleanup errors
                            }
                        }
                    }
                    
                    // Small delay to avoid overwhelming Chrome
                    await new Promise(resolve => setTimeout(resolve, 200));
                    
                } catch (error) {
                    console.log(`   ⚠️  Failed to move tab: ${error.message}`);
                }
            }
            
            console.log(`   ✅ Completed: ${plan.windowName}`);
            
        } catch (error) {
            console.log(`   ❌ Failed to process ${plan.windowName}: ${error.message}`);
        }
        
        console.log('');
    }
    
    console.log('🎉 Reorganization complete!');
    console.log(`📊 Summary:`);
    console.log(`   🪟 New windows created: ${createdWindowsCount}`);
    console.log(`   📋 Tabs moved: ${movedTabsCount}`);
    
    if (movedTabsCount > 0) {
        console.log('\n💡 Tip: You may want to run chromekeep to clean up any remaining unwanted tabs');
    }
}

async function main() {
    try {
        // Check if recommendations filename argument is provided
        const recommendationsFile = process.argv[2];
        if (!recommendationsFile) {
            console.error('❌ Error: Please provide a recommendations markdown filename as the first argument');
            console.error('💡 Usage: node chromereorg.js <recommendations-file.md>');
            console.error('💡 Example: node chromereorg.js chrome-organization-recommendations-2025-08-14T20-34-03-918Z.md');
            process.exit(1);
        }
        
        // Check if the recommendations file exists
        if (!fs.existsSync(recommendationsFile)) {
            console.error(`❌ Error: Recommendations file '${recommendationsFile}' not found`);
            process.exit(1);
        }
        
        console.log('🔄 Chrome Tab Reorganizer');
        console.log(`📄 Reading recommendations from: ${recommendationsFile}\n`);
        
        // Read and parse recommendations file
        console.log('📖 Parsing recommendations...');
        const markdownContent = fs.readFileSync(recommendationsFile, 'utf8');
        const recommendations = parseRecommendationsFile(markdownContent);
        
        if (recommendations.recommended_windows.length === 0) {
            console.error('❌ No reorganization recommendations found in file');
            console.error('💡 Make sure the file is a valid chromerecommend output');
            process.exit(1);
        }
        
        console.log(`✅ Found ${recommendations.recommended_windows.length} window recommendations`);
        
        // Get current Chrome tabs
        console.log('🔍 Reading current Chrome tabs...');
        const currentTabs = await extractChromeTabs();
        console.log(`✅ Found ${currentTabs.length} current tabs across multiple windows\n`);
        
        // Execute the reorganization
        await executeReorganization(recommendations, currentTabs);
        
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
    parseRecommendationsFile,
    matchTabsByDomains,
    executeReorganization,
    main
};