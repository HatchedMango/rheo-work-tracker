import Foundation
import Security

// Disposable native integration fixture; never reads or modifies the login keychain.
let root = CommandLine.arguments[1]
let helper = CommandLine.arguments[2]
let path = root + "/fixture.keychain"
let password = "synthetic-verification-password"
var item: SecKeychain?
let created = password.withCString { SecKeychainCreate(path, UInt32(strlen($0)), $0, false, nil, &item) }
guard created == errSecSuccess, let keychain = item else { fatalError("Fixture keychain creation failed") }
defer { SecKeychainDelete(keychain) }
let id = UUID().uuidString
let secret = "synthetic-verification-token"
func invoke(_ action: String, token: String? = nil) -> (Int32, String) {
  let task = Process()
  task.executableURL = URL(fileURLWithPath: helper)
  task.environment = ["RHEO_TEST_KEYCHAIN": path]
  let input = Pipe(), output = Pipe(), errors = Pipe()
  task.standardInput = input; task.standardOutput = output; task.standardError = errors
  try! task.run()
  var request = ["action": action, "id": id]
  if let token = token { request["token"] = token }
  input.fileHandleForWriting.write(try! JSONSerialization.data(withJSONObject: request))
  try! input.fileHandleForWriting.close()
  let data = output.fileHandleForReading.readDataToEndOfFile()
  task.waitUntilExit()
  return (task.terminationStatus, String(data: data, encoding: .utf8)!)
}
assert(invoke("write", token: secret).0 == 0)
assert(invoke("write", token: "replacement-fixture-token").0 != 0, "Write must not overwrite another credential")
let read = invoke("read")
assert(read.0 == 0 && read.1 == secret)
assert(invoke("remove").0 == 0)
assert(invoke("read").0 != 0)
assert(invoke("remove").0 == 0)
print("PASS: native Keychain bridge write/read/remove in a disposable keychain.")
