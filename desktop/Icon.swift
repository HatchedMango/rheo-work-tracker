import AppKit
import Foundation

@main
struct IconGenerator {
    static func main() throws {
        let directory = CommandLine.arguments[1]
        let identity = try RheoIdentity(url: URL(fileURLWithPath: CommandLine.arguments[2]))
        try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
        for size in [16, 32, 128, 256, 512] {
            for scale in [1, 2] {
                let pixels = size * scale
                // Explicit pixels avoid Retina lockFocus doubling every icon representation.
                // Use sRGB explicitly so the exported PNG matches the web palette on every display.
                let context = CGContext(data: nil, width: pixels, height: pixels, bitsPerComponent: 8,
                    bytesPerRow: pixels * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
                NSGraphicsContext.saveGraphicsState()
                NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
                let canvas = NSRect(x: 0, y: 0, width: pixels, height: pixels)
                let inset = CGFloat(pixels) * identity.macCanvasInset
                identity.drawTile(in: canvas.insetBy(dx: inset, dy: inset))
                NSGraphicsContext.restoreGraphicsState()
                let bitmap = NSBitmapImageRep(cgImage: context.makeImage()!)
                let name = "icon_\(size)x\(size)\(scale == 2 ? "@2x" : "").png"
                try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: directory).appendingPathComponent(name))
            }
        }
    }
}
