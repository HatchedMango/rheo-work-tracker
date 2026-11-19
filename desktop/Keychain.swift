import Foundation
import Security

// A fixed-service bridge: no arbitrary keychain queries, shell, arguments or env secrets.
struct Request: Decodable { let action: String; let id: String; let token: String? }
func fail() -> Never { FileHandle.standardError.write(Data("Keychain operation failed.\n".utf8)); exit(1) }
let data = FileHandle.standardInput.readData(ofLength: 8193)
guard data.count <= 8192, let request = try? JSONDecoder().decode(Request.self, from: data),
      UUID(uuidString: request.id) != nil else { fail() }
var query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
  kSecAttrService as String: "com.rheo.gitlab", kSecAttrAccount as String: request.id]
#if RHEO_TEST_KEYCHAIN
// Compiled only into the verification fixture, never the shipped helper.
guard let path = ProcessInfo.processInfo.environment["RHEO_TEST_KEYCHAIN" ] else { fail() }
var testKeychain: SecKeychain?
guard SecKeychainOpen(path, &testKeychain) == errSecSuccess, let keychain = testKeychain else { fail() }
if request.action == "write" { query[kSecUseKeychain as String] = keychain }
else { query[kSecMatchSearchList as String] = [keychain] }
#endif
switch request.action {
case "write":
  guard let token = request.token, token.count >= 10, token.count <= 2000,
        !token.contains(where: { $0.isWhitespace }) else { fail() }
  var item = query
  item[kSecValueData as String] = Data(token.utf8)
  item[kSecAttrLabel as String] = "Rheo GitLab access"
  guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { fail() }
case "read":
  var item = query
  item[kSecReturnData as String] = true
  item[kSecMatchLimit as String] = kSecMatchLimitOne
  var result: CFTypeRef?
  guard SecItemCopyMatching(item as CFDictionary, &result) == errSecSuccess,
        let secret = result as? Data else { fail() }
  FileHandle.standardOutput.write(secret)
case "remove":
  let status = SecItemDelete(query as CFDictionary)
  guard status == errSecSuccess || status == errSecItemNotFound else { fail() }
default: fail()
}
