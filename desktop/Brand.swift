import AppKit
import Foundation

// The same normalized geometry is used by the web, Dock and menu-bar marks.
struct RheoIdentity {
    let outline: [[Any]]
    let viewBox: CGFloat
    let tileColor: NSColor
    let markColor: NSColor
    let cornerRadius: CGFloat
    let markInset: CGFloat
    let macCanvasInset: CGFloat

    init(url: URL) throws {
        let object = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
        outline = object["outline"] as! [[Any]]
        viewBox = CGFloat((object["viewBox"] as! NSNumber).doubleValue)
        let tile = object["tile"] as! [String: NSNumber]
        cornerRadius = CGFloat(tile["cornerRadius"]!.doubleValue)
        markInset = CGFloat(tile["markInset"]!.doubleValue)
        macCanvasInset = CGFloat((object["macCanvasInset"] as! NSNumber).doubleValue)
        func color(_ key: String) -> NSColor {
            let c = object[key] as! [Double]
            return NSColor(srgbRed: c[0] / 255, green: c[1] / 255, blue: c[2] / 255, alpha: 1)
        }
        tileColor = color("tileColor")
        markColor = color("markColor")
    }

    func drawTile(in rect: NSRect) {
        let scale = rect.width / viewBox
        tileColor.setFill()
        NSBezierPath(roundedRect: rect, xRadius: cornerRadius * scale, yRadius: cornerRadius * scale).fill()
        draw(in: rect.insetBy(dx: markInset * scale, dy: markInset * scale), color: markColor)
    }

    func draw(in rect: NSRect, color: NSColor) {
        let scale = min(rect.width, rect.height) / viewBox
        func point(_ command: [Any], _ offset: Int) -> NSPoint {
            NSPoint(x: rect.minX + CGFloat((command[offset] as! NSNumber).doubleValue) * scale,
                    y: rect.maxY - CGFloat((command[offset + 1] as! NSNumber).doubleValue) * scale)
        }
        color.setFill()
        let path = NSBezierPath()
        for command in outline {
            switch command[0] as! String {
            case "M": path.move(to: point(command, 1))
            case "L": path.line(to: point(command, 1))
            case "C": path.curve(to: point(command, 5), controlPoint1: point(command, 1), controlPoint2: point(command, 3))
            case "Z": path.close()
            default: preconditionFailure("Unsupported brand geometry")
            }
        }
        path.fill()
    }

    func menuImage() -> NSImage {
        // Draw at the destination resolution; do not capture one display's backing scale.
        let image = NSImage(size: NSSize(width: 20, height: 20), flipped: false) { rect in
            draw(in: rect, color: .black)
            return true
        }
        image.isTemplate = true
        image.accessibilityDescription = "Rheo"
        return image
    }
}
