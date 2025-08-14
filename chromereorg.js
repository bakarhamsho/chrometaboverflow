#!/usr/bin/env node

require('dotenv').config();

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');
const OpenAI = require('openai');

// Import tab extraction function from chromekeep
const { extractChromeTabs } = require('./chromekeep');

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Function to generate reorganization instructions using GPT-5
async function generateReorganizationInstructions(currentTabs, recommendationsContent) {
    console.log('🤖 Generating fresh reorganization instructions with GPT-5...');
    
    // Prepare current tab data
    const currentTabData = currentTabs.map(tab => ({
        title: tab.title,
        url: tab.url,
        domain: new URL(tab.url).hostname,
        windowIndex: tab.windowIndex,
        tabIndex: tab.tabIndex
    }));
    
    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-5',
            messages: [
                {
                    role: 'system',
                    content: `You are a Chrome tab reorganization executor. You will analyze current open tabs and previous recommendations to generate specific, actionable reorganization instructions.

Your task is to:
1. Analyze the current tab state
2. Consider the previous recommendations 
3. Generate specific move instructions based on CURRENT tabs only

You MUST return a JSON object with this exact structure:
{
  "reorganization_plan": [
    {
      "window_name": "Descriptive name for this window group",
      "purpose": "What this window is for",
      "action": "create_new_window" or "use_existing_window",
      "target_window_index": 1 (only for use_existing_window),
      "tabs_to_move": [
        {
          "url": "exact URL of tab to move",
          "title": "tab title",
          "reason": "why this tab belongs in this window"
        }
      ]
    }
  ],
  "summary": "Brief description of the reorganization plan"
}`
                },
                {
                    role: 'user',
                    content: `Based on these previous recommendations and current tab state, generate specific reorganization instructions.

PREVIOUS RECOMMENDATIONS:
${recommendationsContent}

CURRENT OPEN TABS:
${JSON.stringify(currentTabData, null, 2)}

Please generate a reorganization plan that:
1. Only moves tabs that currently exist
2. Groups related tabs logically
3. Creates new windows as needed
4. Uses exact URLs for matching tabs
5. Provides clear reasoning for each grouping

Focus on practical productivity improvements while working with the ACTUAL current tab state.`
                }
            ],
            temperature: 0.2
        });
        
        const content = response.choices[0]?.message?.content || '{}';
        
        // Try to parse JSON response
        try {
            return JSON.parse(content);
        } catch (parseError) {
            console.error('❌ Failed to parse GPT-5 response as JSON:', parseError.message);
            console.log('Raw response:', content);
            throw new Error('Invalid response format from GPT-5');
        }
        
    } catch (error) {
        console.error('❌ Error generating reorganization instructions:', error.message);
        throw error;
    }
}

// Function to execute reorganization plan
async function executeReorganizationPlan(reorganizationPlan, currentTabs) {
    if (!reorganizationPlan.reorganization_plan || reorganizationPlan.reorganization_plan.length === 0) {
        console.log('❌ No reorganization plan found');
        return;
    }
    
    const plan = reorganizationPlan.reorganization_plan;
    console.log('🔍 Generated reorganization plan:\n');
    console.log(`📋 Summary: ${reorganizationPlan.summary}\n`);
    
    // Show what will be reorganized
    let totalTabsToMove = 0;
    let newWindowsToCreate = 0;
    
    plan.forEach((windowPlan, index) => {
        console.log(`${index + 1}. **${windowPlan.window_name}**`);
        console.log(`   Purpose: ${windowPlan.purpose}`);
        console.log(`   Action: ${windowPlan.action}`);
        console.log(`   Tabs to move: ${windowPlan.tabs_to_move.length}`);
        
        windowPlan.tabs_to_move.forEach(tab => {
            console.log(`     • ${tab.title.substring(0, 60)}... (${tab.reason})`);
        });
        
        totalTabsToMove += windowPlan.tabs_to_move.length;
        if (windowPlan.action === 'create_new_window') newWindowsToCreate++;
        console.log('');
    });
    
    // Confirm execution
    const confirmAnswer = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'confirmReorg',
            message: `Execute this reorganization plan? This will create ${newWindowsToCreate} new windows and move ${totalTabsToMove} tabs.`,
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
    const windowIndexMap = {}; // Map to track created window indices
    
    for (let planIndex = 0; planIndex < plan.length; planIndex++) {
        const windowPlan = plan[planIndex];
        
        console.log(`⏳ Processing: ${windowPlan.window_name}...`);
        
        try {
            let targetWindowIndex;
            
            if (windowPlan.action === 'create_new_window') {
                // Create new window
                console.log(`   🪟 Creating new window...`);
                
                const createWindowScript = `
                    tell application "Google Chrome"
                        set newWindow to make new window
                        return (count of windows)
                    end tell
                `;
                
                const tempScriptPath = path.join(process.cwd(), 'temp_create_window.scpt');
                fs.writeFileSync(tempScriptPath, createWindowScript, 'utf8');
                
                try {
                    const result = execSync(`osascript "${tempScriptPath}"`, { encoding: 'utf8' });
                    targetWindowIndex = parseInt(result.trim());
                    windowIndexMap[windowPlan.window_name] = targetWindowIndex;
                    createdWindowsCount++;
                } finally {
                    try {
                        fs.unlinkSync(tempScriptPath);
                    } catch (cleanupError) {
                        // Ignore cleanup errors
                    }
                }
            } else if (windowPlan.action === 'use_existing_window') {
                targetWindowIndex = windowPlan.target_window_index || 1;
            }
            
            // Move tabs to the target window
            for (let tabIndex = 0; tabIndex < windowPlan.tabs_to_move.length; tabIndex++) {
                const tabToMove = windowPlan.tabs_to_move[tabIndex];
                
                try {
                    console.log(`   📋 Moving: ${tabToMove.title.substring(0, 50)}...`);
                    
                    // Re-read current tabs to get fresh indices (tabs shift as we move them)
                    const freshTabs = await extractChromeTabs();
                    const currentTab = freshTabs.find(t => t.url === tabToMove.url);
                    
                    if (!currentTab) {
                        console.log(`   ⚠️  Tab no longer found: ${tabToMove.url}`);
                        continue;
                    }
                    
                    // Move tab to target window
                    const moveScript = `
                        tell application "Google Chrome"
                            move tab ${currentTab.tabIndex} of window ${currentTab.windowIndex} to end of window ${targetWindowIndex}
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
                    
                    // Small delay to avoid overwhelming Chrome
                    await new Promise(resolve => setTimeout(resolve, 300));
                    
                } catch (error) {
                    console.log(`   ⚠️  Failed to move tab: ${error.message}`);
                }
            }
            
            console.log(`   ✅ Completed: ${windowPlan.window_name}`);
            
        } catch (error) {
            console.log(`   ❌ Failed to process ${windowPlan.window_name}: ${error.message}`);
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
        // Check for OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.error('❌ Error: OPENAI_API_KEY environment variable is required');
            console.error('💡 Set it with: export OPENAI_API_KEY=your_api_key_here');
            process.exit(1);
        }
        
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
        
        // Read recommendations file as raw text
        console.log('📖 Reading recommendations content...');
        const recommendationsContent = fs.readFileSync(recommendationsFile, 'utf8');
        
        // Get current Chrome tabs (fresh state)
        console.log('🔍 Reading current Chrome tabs...');
        const currentTabs = await extractChromeTabs();
        console.log(`✅ Found ${currentTabs.length} current tabs across multiple windows\n`);
        
        // Generate fresh reorganization instructions using GPT-5
        const reorganizationPlan = await generateReorganizationInstructions(currentTabs, recommendationsContent);
        
        // Execute the reorganization
        await executeReorganizationPlan(reorganizationPlan, currentTabs);
        
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
    generateReorganizationInstructions,
    executeReorganizationPlan,
    main
};