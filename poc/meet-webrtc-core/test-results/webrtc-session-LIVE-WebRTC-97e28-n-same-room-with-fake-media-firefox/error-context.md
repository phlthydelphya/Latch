# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: webrtc-session.spec.ts >> LIVE WebRTC session: 2 browsers join same room with fake media
- Location: tests\e2e\webrtc-session.spec.ts:13:1

# Error details

```
Test timeout of 300000ms exceeded.
```

# Page snapshot

```yaml
- generic [ref=f1e2]:
  - link "Skip to main content" [ref=f1e3] [cursor=pointer]:
    - /url: "#main"
  - main [ref=f1e4]:
    - region "Meeting ready" [ref=f1e5]:
      - generic [ref=f1e6]:
        - heading "Meeting ready" [level=2] [ref=f1e10]
        - paragraph [ref=f1e11]: Share the link with participants before starting.
      - generic "Meeting link" [ref=f1e12]: http://127.0.0.1:5173/r/3xmbkkdyy6onr57d#k=e77d5b9e5d5a22c7ba830cbd76ff48d45109fdba2c26eee5fbfb33549d40b814
      - generic [ref=f1e13]:
        - button "🔗 Copy link" [ref=f1e14] [cursor=pointer]
        - button "✉ Copy invitation" [ref=f1e15] [cursor=pointer]
        - button "📱 Show QR code" [ref=f1e16] [cursor=pointer]
      - button "Start Meeting →" [active] [ref=f1e17] [cursor=pointer]
```