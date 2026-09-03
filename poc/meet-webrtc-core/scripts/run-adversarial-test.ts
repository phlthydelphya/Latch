#!/usr/bin/env node

/**
 * Simple adversarial performance test runner
 * Demonstrates the 20-participant, 27-stream scenario
 */

import { adversarialHarness, AdversarialTestResult } from './scripts/adversarial-performance-harness';

async function runAdversarialTest() {
  console.log("=== Adversarial Performance Test Runner ===");
  console.log("Testing 20-participant, 27-stream scenario");
  console.log("Measuring CPU, memory, and packet frame latency");
  console.log("");

  try {
    const result: AdversarialTestResult = await adversarialHarness.runTest();
    
    console.log("=== TEST RESULTS ===");
    console.log(`Status: ${result.passed ? 'PASS' : 'FAIL'}`);
    console.log(`Timestamp: ${new Date(result.timestamp).toISOString()}`);
    console.log("");
    
    console.log("Performance Metrics:");
    console.log(`  CPU Usage: ${result.metrics.cpuPercent}%`);
    console.log(`  Memory: ${result.metrics.memoryMB} MB`);
    console.log(`  Packet Loss: ${result.metrics.packetLossPercent}%`);
    console.log(`  P50 Latency: ${result.metrics.p50LatencyMs} ms`);
    console.log(`  P95 Latency: ${result.metrics.p95LatencyMs} ms`);
    console.log(`  Total Streams: ${result.metrics.totalStreams}`);
    console.log(`  Active Participants: ${result.metrics.activeParticipants}`);
    
    if (result.errors.length > 0) {
      console.log("\nErrors:");
      result.errors.forEach(error => console.log(`  - ${error}`));
    }
    
    if (result.passed) {
      console.log("\n✅ All performance criteria met!");
      console.log("M0-P0 adversarial performance test PASSED");
    } else {
      console.log("\n❌ Performance criteria not met");
      console.log("M0-P0 adversarial performance test FAILED");
    }
    
    return result.passed ? 0 : 1;
  } catch (error) {
    console.error("Test execution failed:", error);
    return 1;
  }
}

if (require.main === module) {
  runAdversarialTest().then(exitCode => process.exit(exitCode));
}