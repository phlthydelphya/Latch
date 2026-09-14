import re
with open('services/meet-signal/main_test.go', 'r', encoding='utf-8') as f: content = f.read()

content = content.replace('hdrConflict := http.Header{"Sec-WebSocket-Protocol": {"meet-token, " + targetResp.Token}}', 'hdrConflict := http.Header{"Sec-WebSocket-Protocol": {"meet-token, " + signedConflict}}')
content = content.replace('hdrTarget := http.Header{"Sec-WebSocket-Protocol": {"meet-token, " + targetResp.Token}}', 'hdrTarget := http.Header{"Sec-WebSocket-Protocol": {"meet-token, " + signedTarget}}')
content = content.replace('hdrGuest := http.Header{"Sec-WebSocket-Protocol": {"meet-token, " + guestResp.Token}}', 'hdrGuest := http.Header{"Sec-WebSocket-Protocol": {"meet-token, " + signedGuest}}')

with open('services/meet-signal/main_test.go', 'w', encoding='utf-8') as f: f.write(content)
