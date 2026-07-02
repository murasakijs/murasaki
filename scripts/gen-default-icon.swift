import Cocoa

// murasaki butterfly grid (same as create-murasaki banner)
let GRID = [
  ".....b.......b.....",
  "......b.....b......",
  "...bbbb.....bbbb...",
  "..bbbbbb...bbbbbb..",
  ".bbbbcbbb.bbbcbbbb.",
  ".bbbbbbbb.bbbbbbbb.",
  "..bbbbbbb.bbbbbbb..",
  "...bbbbb...bbbbb...",
  "...................",
  ".....ddd...ddd.....",
  "....ddddd.ddddd....",
  ".....dddd.dddd.....",
]
let cols = 19, rows = 12
let S = 1024

func col(_ hex: UInt32) -> NSColor {
  NSColor(srgbRed: CGFloat((hex>>16)&0xff)/255, green: CGFloat((hex>>8)&0xff)/255, blue: CGFloat(hex&0xff)/255, alpha: 1)
}
let bright = col(0xa855f7)   // b
let deep   = col(0x5b21b6)   // d
let cream  = col(0xfaf5e8)   // c

let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: S, pixelsHigh: S, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let ctx = NSGraphicsContext.current!.cgContext

// rounded-rect app-icon background with vertical purple gradient
let radius: CGFloat = 224
let bgRect = NSRect(x: 0, y: 0, width: S, height: S)
let path = NSBezierPath(roundedRect: bgRect, xRadius: radius, yRadius: radius)
path.addClip()
let grad = NSGradient(colors: [col(0x2a1149), col(0x160a26)])!
grad.draw(in: bgRect, angle: -90)

// draw the butterfly grid, centered, ~72% of canvas
let cell = CGFloat(min(Int(Double(S) * 0.94) / cols, Int(Double(S) * 0.94) / rows))
let gw = cell * CGFloat(cols), gh = cell * CGFloat(rows)
let xOff = (CGFloat(S) - gw) / 2
let yOffTop = (CGFloat(S) - gh) / 2
let pad = cell * 0.06
for (r, line) in GRID.enumerated() {
  for (c, ch) in Array(line).enumerated() {
    let color: NSColor
    switch ch { case "b": color = bright; case "d": color = deep; case "c": color = cream; default: continue }
    let x = xOff + CGFloat(c) * cell + pad
    // flip y: grid row 0 is top, CG origin is bottom-left
    let yTop = yOffTop + CGFloat(r) * cell + pad
    let y = CGFloat(S) - yTop - (cell - 2*pad)
    let sz = cell - 2*pad
    let cellPath = NSBezierPath(roundedRect: NSRect(x: x, y: y, width: sz, height: sz), xRadius: sz*0.28, yRadius: sz*0.28)
    color.setFill()
    cellPath.fill()
    _ = ctx
  }
}
NSGraphicsContext.restoreGraphicsState()

let png = rep.representation(using: .png, properties: [:])!
try! png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
print("wrote \(CommandLine.arguments[1])")
