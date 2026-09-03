#!/usr/bin/env tsx
import { execSync } from 'child_process';
import fs from 'fs';

async function runLighthouseTest() {
  console.log('Running Lighthouse test for PWA frontend...');
  
  try {
    // Build the project first
    console.log('Building project...');
    execSync('npm run build', { cwd: 'poc/meet-webrtc-core', stdio: 'inherit' });
    
    // Start preview server
    console.log('Starting preview server...');
    const previewProcess = execSync('npm run preview', { 
      cwd: 'poc/meet-webrtc-core', 
      stdio: 'pipe' 
    });
    
    // Give server time to start
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Run Lighthouse test
    console.log('Running Lighthouse audit...');
    const lighthouseResult = execSync(
      'npm run lighthouse', 
      { cwd: 'poc/meet-webrtc-core', stdio: 'inherit' }
    );
    
    console.log('Lighthouse test completed successfully');
    
    // Check if the report exists and has good scores
    const reportPath = 'poc/meet-webrtc-core/qa/reports/lighthouse/lighthouse-report.json';
    if (fs.existsSync(reportPath)) {
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
      const performanceScore = report.categories.performance.score;
      const accessibilityScore = report.categories.accessibility.score;
      const bestPracticesScore = report.categories['best-practices'].score;
      
      console.log(`Performance Score: ${performanceScore}`);
      console.log(`Accessibility Score: ${accessibilityScore}`);
      console.log(`Best Practices Score: ${bestPracticesScore}`);
      
      if (performanceScore >= 0.95 && accessibilityScore >= 0.95 && bestPracticesScore >= 0.95) {
        console.log('✅ All Lighthouse scores meet the >95 requirement');
        return true;
      } else {
        console.log('❌ Some Lighthouse scores do not meet the >95 requirement');
        return false;
      }
    } else {
      console.log('❌ Lighthouse report not found');
      return false;
    }
  } catch (error) {
    console.error('Error running Lighthouse test:', error);
    return false;
  }
}

runLighthouseTest().then(success => {
  process.exit(success ? 0 : 1);
});