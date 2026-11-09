import AppKit
import Foundation
let directory = CommandLine.arguments[1]
try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        let image = NSImage(size: NSSize(width: pixels, height: pixels))
        image.lockFocus()
        let s = CGFloat(pixels) / 1024
        NSColor(white: 0.95, alpha: 1).setFill()
        NSBezierPath(roundedRect: NSRect(x: 12*s, y: 12*s, width: 1000*s, height: 1000*s), xRadius: 220*s, yRadius: 220*s).fill()
        let tray = NSBezierPath()
        tray.move(to: NSPoint(x: 208*s, y: 610*s))
        tray.line(to: NSPoint(x: 312*s, y: 760*s))
        tray.line(to: NSPoint(x: 712*s, y: 760*s))
        tray.line(to: NSPoint(x: 816*s, y: 610*s))
        tray.line(to: NSPoint(x: 816*s, y: 300*s))
        tray.line(to: NSPoint(x: 208*s, y: 300*s))
        tray.close()
        NSColor(white: 0.16, alpha: 1).setStroke()
        tray.lineWidth = 48*s
        tray.lineJoinStyle = .round
        tray.stroke()
        let slot = NSBezierPath()
        slot.move(to: NSPoint(x: 218*s, y: 540*s))
        slot.line(to: NSPoint(x: 395*s, y: 540*s))
        slot.line(to: NSPoint(x: 435*s, y: 455*s))
        slot.line(to: NSPoint(x: 589*s, y: 455*s))
        slot.line(to: NSPoint(x: 629*s, y: 540*s))
        slot.line(to: NSPoint(x: 806*s, y: 540*s))
        slot.lineWidth = 48*s
        slot.lineJoinStyle = .round
        slot.stroke()
        image.unlockFocus()
        let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
        let name = "icon_\(size)x\(size)\(scale == 2 ? "@2x" : "").png"
        try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: directory).appendingPathComponent(name))
    }
}
