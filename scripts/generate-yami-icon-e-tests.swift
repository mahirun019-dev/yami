import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let sourceURL = root.appendingPathComponent("src/assets/brand/yami-brand-avatar-core-512-v1.png")
let testRoot = root.appendingPathComponent("public/icon-test", isDirectory: true)

guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
      let avatar = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
  fatalError("Could not load the approved Yami avatar core")
}

func pngData(size: Int, background: CGColor) -> Data {
  let colorSpace = CGColorSpaceCreateDeviceRGB()
  let bitmapInfo = CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue
  guard let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4, space: colorSpace, bitmapInfo: bitmapInfo) else {
    fatalError("Could not create a \(size)px icon canvas")
  }

  context.interpolationQuality = .high
  context.setFillColor(background)
  context.fill(CGRect(x: 0, y: 0, width: size, height: size))

  let extent = CGFloat(size) * (2.0 / 3.0)
  let artwork = CGRect(x: (CGFloat(size) - extent) / 2, y: (CGFloat(size) - extent) / 2, width: extent, height: extent)
  context.saveGState()
  context.clip(to: artwork, mask: avatar)
  context.setFillColor(CGColor(gray: 1, alpha: 1))
  context.fill(artwork)
  context.restoreGState()

  guard let rendered = context.makeImage() else { fatalError("Could not render a \(size)px icon") }
  let data = NSMutableData()
  guard let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else {
    fatalError("Could not encode a \(size)px PNG")
  }
  CGImageDestinationAddImage(destination, rendered, nil)
  guard CGImageDestinationFinalize(destination) else { fatalError("Could not finish a \(size)px PNG") }
  return data as Data
}

func writeVariant(_ name: String, background: CGColor) throws {
  let directory = testRoot.appendingPathComponent(name, isDirectory: true)
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  for (size, filename) in [
    (180, "apple-touch-icon.png"),
    (192, "icon-192.png"),
    (512, "icon-512.png"),
    (512, "icon-maskable-512.png"),
  ] {
    try pngData(size: size, background: background).write(to: directory.appendingPathComponent(filename), options: .atomic)
  }
}

try writeVariant("e1", background: CGColor(red: 36 / 255, green: 119 / 255, blue: 217 / 255, alpha: 1))
try writeVariant("e2", background: CGColor(red: 17 / 255, green: 19 / 255, blue: 24 / 255, alpha: 1))
print("Generated E1/E2 only under public/icon-test from the approved Yami avatar core.")
