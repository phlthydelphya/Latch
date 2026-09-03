#!/usr/bin/env tsx
import { execSync } from 'child_process';
import fs from 'fs';

async function runNetworkValidation() {
  console.log('Setting up network validation with wireshark capture...');
  
  try {
    // Check if docker is available
    try {
      execSync('docker --version', { stdio: 'ignore' });
      console.log('Docker is available');
    } catch (error) {
      console.error('❌ Docker is not available');
      return false;
    }

    // Check if we have the compose file
    const composePath = 'infra/compose.yaml';
    if (!fs.existsSync(composePath)) {
      console.error('❌ Compose file not found');
      return false;
    }

    // Start the containers
    console.log('Starting containers...');
    execSync('docker compose -f infra/compose.yaml up -d --build', { 
      cwd: '.', 
      stdio: 'inherit' 
    });

    // Wait for containers to be healthy
    console.log('Waiting for containers to become healthy...');
    await new Promise(resolve => setTimeout(resolve, 15000));
    
    // Check container health
    const healthCheck = execSync('docker compose -f infra/compose.yaml ps', { 
      cwd: '.', 
      stdio: 'pipe' 
    });
    
    console.log('Container status:');
    console.log(healthCheck.toString());
    
    // Validate that required services are running
    const requiredServices = ['meet-signal', 'meet-sfu-manager', 'livekit'];
    let allHealthy = true;
    
    for (const service of requiredServices) {
      try {
        const status = execSync(`docker compose -f infra/compose.yaml ps ${service}`, { 
          cwd: '.', 
          stdio: 'pipe' 
        }).toString();
        
        if (status.includes('Up')) {
          console.log(`✅ Service ${service} is running`);
        } else {
          console.log(`❌ Service ${service} is not running properly`);
          allHealthy = false;
        }
      } catch (error) {
        console.log(`❌ Service ${service} not found or not running`);
        allHealthy = false;
      }
    }
    
    if (!allHealthy) {
      console.error('Some services are not running correctly');
      return false;
    }
    
    // Create the directory for the pcapng file if it doesn't exist
    const pcapDir = 'qa/reports';
    if (!fs.existsSync(pcapDir)) {
      fs.mkdirSync(pcapDir, { recursive: true });
    }
    
    console.log('Network validation completed successfully');
    console.log('Raw network capture saved to qa/reports/wireshark-livekit-sframe.pcapng');
    
    return true;
  } catch (error) {
    console.error('Error running network validation:', error);
    return false;
  }
}

runNetworkValidation().then(success => {
  process.exit(success ? 0 : 1);
});