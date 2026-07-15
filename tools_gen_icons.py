#!/usr/bin/env python3
# Generate a CSS mask-based monoline icon set (Feather/Lucide style, 24x24, 2px stroke).
# Each icon becomes a .ic-<name> class; <span class="ic ic-<name>"></span> renders it
# in currentColor, sized by font-size (1em). One coherent language for app + landing.
from urllib.parse import quote

# inner SVG markup per icon (children of <svg viewBox="0 0 24 24" stroke=currentColor ...>)
I = {
 # status / actions
 "check":      "<polyline points='20 6 9 17 4 12'/>",
 "check-circle":"<circle cx='12' cy='12' r='9'/><polyline points='16 9.5 10.5 15 8 12.5'/>",
 "x":          "<line x1='18' y1='6' x2='6' y2='18'/><line x1='6' y1='6' x2='18' y2='18'/>",
 "plus":       "<line x1='12' y1='5' x2='12' y2='19'/><line x1='5' y1='12' x2='19' y2='12'/>",
 "alert":      "<path d='M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z'/><line x1='12' y1='9' x2='12' y2='13'/><line x1='12' y1='17' x2='12.01' y2='17'/>",
 "edit":       "<path d='M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7'/><path d='M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z'/>",
 "trash":      "<polyline points='3 6 5 6 21 6'/><path d='M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'/>",
 "share":      "<path d='M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8'/><polyline points='16 6 12 2 8 6'/><line x1='12' y1='2' x2='12' y2='15'/>",
 "download":   "<path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'/><polyline points='7 10 12 15 17 10'/><line x1='12' y1='15' x2='12' y2='3'/>",
 "printer":    "<polyline points='6 9 6 2 18 2 18 9'/><path d='M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2'/><rect x='6' y='14' width='12' height='8'/>",
 "settings":   "<circle cx='12' cy='12' r='3'/><path d='M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H7a1.6 1.6 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V7a1.6 1.6 0 0 0 1.5 1H23a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z'/>",
 "refresh":    "<polyline points='23 4 23 10 17 10'/><polyline points='1 20 1 14 7 14'/><path d='M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15'/>",
 "clipboard":  "<path d='M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2'/><rect x='8' y='2' width='8' height='4' rx='1'/>",
 "tag":        "<path d='M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z'/><line x1='7' y1='7' x2='7.01' y2='7'/>",
 "flag":       "<path d='M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1Z'/><line x1='4' y1='22' x2='4' y2='15'/>",
 "clock":      "<circle cx='12' cy='12' r='9'/><polyline points='12 7 12 12 15 14'/>",
 "search":     "<circle cx='11' cy='11' r='7'/><line x1='21' y1='21' x2='16.65' y2='16.65'/>",
 "chevron-right":"<polyline points='9 6 15 12 9 18'/>",
 # people / spaces
 "brain":      "<path d='M9.5 3a2.5 2.5 0 0 0-2.5 2.5A2.5 2.5 0 0 0 4.5 8 2.5 2.5 0 0 0 4 12a2.5 2.5 0 0 0 .5 4A2.5 2.5 0 0 0 7 18.5 2.5 2.5 0 0 0 9.5 21 2 2 0 0 0 12 19V5a2 2 0 0 0-2.5-2Z'/><path d='M14.5 3A2.5 2.5 0 0 1 17 5.5 2.5 2.5 0 0 1 19.5 8 2.5 2.5 0 0 1 20 12a2.5 2.5 0 0 1-.5 4A2.5 2.5 0 0 1 17 18.5 2.5 2.5 0 0 1 14.5 21 2 2 0 0 1 12 19V5a2 2 0 0 1 2.5-2Z'/>",
 "handshake":  "<path d='m11 17 2 2a1 1 0 0 0 1.4 0l3.6-3.6'/><path d='m18 15 2-2a1 1 0 0 0 0-1.4l-4-4-3 3-3-3-5 5a1 1 0 0 0 0 1.4l2 2'/><path d='m7 14 3 3'/><path d='M14 6h5l2 2'/><path d='M3 8l2-2h5'/>",
 "heart":      "<path d='M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z'/>",
 "family":     "<circle cx='9' cy='7' r='3'/><circle cx='17' cy='9' r='2.2'/><path d='M2.5 21v-1a6.5 6.5 0 0 1 13 0v1'/><path d='M16 21v-1a5 5 0 0 1 5.5-5'/>",
 "users":      "<path d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'/><circle cx='9' cy='7' r='4'/><path d='M22 21v-2a4 4 0 0 0-3-3.9'/><path d='M16 3.1a4 4 0 0 1 0 7.8'/>",
 "user":       "<path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'/><circle cx='12' cy='7' r='4'/>",
 "user-plus":  "<path d='M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'/><circle cx='8.5' cy='7' r='4'/><line x1='19' y1='8' x2='19' y2='14'/><line x1='22' y1='11' x2='16' y2='11'/>",
 # domain
 "pill":       "<path d='M10.5 20.5a4.9 4.9 0 0 1-7-7l6-6a4.9 4.9 0 0 1 7 7Z'/><line x1='8.5' y1='8.5' x2='15.5' y2='15.5'/>",
 "calendar":   "<rect x='3' y='4' width='18' height='18' rx='2'/><line x1='16' y1='2' x2='16' y2='6'/><line x1='8' y1='2' x2='8' y2='6'/><line x1='3' y1='10' x2='21' y2='10'/>",
 "calendar-check":"<rect x='3' y='4' width='18' height='18' rx='2'/><line x1='16' y1='2' x2='16' y2='6'/><line x1='8' y1='2' x2='8' y2='6'/><line x1='3' y1='10' x2='21' y2='10'/><polyline points='9 15 11 17 15 13'/>",
 "stethoscope":"<path d='M4 3v6a5 5 0 0 0 10 0V3'/><path d='M4 3H2m2 0h2M14 3h-2m2 0h2'/><path d='M9 14v2a5 5 0 0 0 10 0v-1'/><circle cx='19' cy='11' r='2.5'/>",
 "dollar":     "<line x1='12' y1='1' x2='12' y2='23'/><path d='M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6'/>",
 "battery":    "<rect x='2' y='7' width='16' height='10' rx='2'/><line x1='22' y1='11' x2='22' y2='13'/><line x1='6' y1='11' x2='6' y2='13'/><line x1='10' y1='11' x2='10' y2='13'/>",
 "scroll":     "<path d='M8 3H6a2 2 0 0 0-2 2v12a3 3 0 0 0 3 3h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2'/><path d='M4 17a3 3 0 0 0 3 3'/><line x1='9' y1='8' x2='16' y2='8'/><line x1='9' y1='12' x2='16' y2='12'/>",
 "note":       "<path d='M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z'/><polyline points='14 3 14 9 20 9'/><line x1='8' y1='13' x2='15' y2='13'/><line x1='8' y1='17' x2='13' y2='17'/>",
 "wand":       "<path d='M15 4V2m0 20v-2M8.5 8.5 7 7m10 10-1.5-1.5M4 15H2m20 0h-2'/><path d='M12.5 6.5 3 16l1.4 1.4L14 8Z'/>",
 "sparkles":   "<path d='M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9Z'/><path d='M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7Z'/>",
 "target":     "<circle cx='12' cy='12' r='9'/><circle cx='12' cy='12' r='5'/><circle cx='12' cy='12' r='1'/>",
 "trophy":     "<path d='M6 4h12v4a6 6 0 0 1-12 0Z'/><path d='M6 6H4a2 2 0 0 0 2 4m12-4h2a2 2 0 0 1-2 4'/><line x1='12' y1='14' x2='12' y2='18'/><path d='M8 21h8m-6-3h4'/>",
 "moon":       "<path d='M21 12.8A8.5 8.5 0 1 1 11.2 3 6.6 6.6 0 0 0 21 12.8Z'/>",
 "leaf":       "<path d='M11 20A7 7 0 0 1 4 13c0-6 5-9 16-9 0 9-4 13-9 13Z'/><path d='M4 20c3-4 6-6 12-8'/>",
 "lock":       "<rect x='4' y='11' width='16' height='10' rx='2'/><path d='M8 11V7a4 4 0 0 1 8 0v4'/>",
 "feather":    "<path d='M20 4a6.7 6.7 0 0 0-9.4 0L4 10.6V20h9.4L20 13.4A6.7 6.7 0 0 0 20 4Z'/><line x1='16' y1='8' x2='2' y2='22'/><line x1='9' y1='13' x2='15' y2='13'/>",
 "bulb":       "<path d='M9 18h6M10 21h4'/><path d='M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1h6c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2Z'/>",
 "bell":       "<path d='M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9'/><path d='M13.7 21a2 2 0 0 1-3.4 0'/>",
 "mic":        "<rect x='9' y='2' width='6' height='11' rx='3'/><path d='M19 10v1a7 7 0 0 1-14 0v-1'/><line x1='12' y1='18' x2='12' y2='22'/><line x1='8' y1='22' x2='16' y2='22'/>",
 "party":      "<path d='M2 22l4.5-13 8.5 8.5Z'/><path d='M14 6a3 3 0 0 0-3-3m8 3a3 3 0 0 0-3 3m3 5a3 3 0 0 1 3 3m-9-9 2-2m3 8 3-1'/>",
 "access":     "<circle cx='12' cy='4' r='1.5'/><path d='M6 8h12l-4 1v4l2 6m-6-10v4l-2 6'/>",
 "home":       "<path d='M3 10.5 12 3l9 7.5'/><path d='M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5'/><path d='M9 21v-6h6v6'/>",
 "spark":      "<path d='M12 2l1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6Z'/>",
 "mail":       "<rect x='3' y='5' width='18' height='14' rx='2'/><path d='m3 7 9 6 9-6'/>",
 "camera":     "<path d='M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h6l2 3h3a2 2 0 0 1 2 2Z'/><circle cx='12' cy='13' r='4'/>",
 "flame":      "<path d='M12 3c3 4 5 6 5 9a5 5 0 0 1-10 0c0-1 .3-2 1-3 .4 1 1.1 1.5 1.6 1.5-.6-2 .4-5 2.4-7.5Z'/>",
 "package":    "<path d='M21 8 12 3 3 8v8l9 5 9-5Z'/><path d='m3 8 9 5 9-5M12 13v8'/>",
}

HEADER = ("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' "
          "stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>")

def enc(inner):
    svg = HEADER + inner + "</svg>"
    # url-encode the bits that matter inside url("data:...")
    return svg.replace('<','%3C').replace('>','%3E').replace('#','%23').replace('"',"'")

lines = []
lines.append("/* Monoline icon set — generated. Each icon is a currentColor CSS mask.")
lines.append("   Usage: <span class=\"ic ic-mic\" aria-hidden=\"true\"></span>  (scales with font-size) */")
lines.append(".ic{display:inline-block;width:1em;height:1em;flex:0 0 auto;vertical-align:-0.14em;")
lines.append("  background-color:currentColor;-webkit-mask:var(--i) center/contain no-repeat;mask:var(--i) center/contain no-repeat;}")
for name, inner in I.items():
    lines.append(f".ic-{name}{{--i:url(\"data:image/svg+xml,{enc(inner)}\")}}")
open("icons.css","w").write("\n".join(lines)+"\n")
print("wrote icons.css with", len(I), "icons,", sum(len(l) for l in lines), "bytes")
print("names:", " ".join(I.keys()))
