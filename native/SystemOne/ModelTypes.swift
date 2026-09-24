import Foundation

enum ModelRole: String, Codable { case decision, text }
enum Retention: String, Codable { case warm, fiveMinutes = "five_minutes", cold }
enum ModelSelection: Codable {
    case local(String)
    case endpoint(url: String, model: String)
    private enum Keys: String, CodingKey { case source, id, url, model }
    private enum Source: String, Codable { case local, endpoint }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: Keys.self)
        switch try values.decode(Source.self, forKey: .source) {
        case .local: self = .local(try values.decode(String.self, forKey: .id))
        case .endpoint: self = .endpoint(url: try values.decode(String.self, forKey: .url), model: try values.decode(String.self, forKey: .model))
        }
    }
    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: Keys.self)
        switch self {
        case .local(let id): try values.encode(Source.local, forKey: .source); try values.encode(id, forKey: .id)
        case .endpoint(let url, let model):
            try values.encode(Source.endpoint, forKey: .source)
            try values.encode(url, forKey: .url); try values.encode(model, forKey: .model)
        }
    }
}
struct ModelPreferences: Codable {
    let decision: ModelSelection
    let text: ModelSelection
    let retention: Retention
}
struct ModelPreset: Decodable { let id: String; let name: String; let role: ModelRole; let description: String }
struct ModelStatus: Decodable {
    enum State: String, Decodable { case unloaded, downloading, loading, ready, error }
    let role: ModelRole
    let state: State
    let message: String
}
struct ModelEvent: Decodable {
    enum Kind: String, Decodable { case status, prepared, error }
    let event: Kind
    let preferences: ModelPreferences?
    let catalog: [ModelPreset]?
    let models: [ModelStatus]?
    let message: String?
    let requestId: String?
}
struct ModelCommand: Encodable {
    enum Operation: String, Encodable { case configure, prepare, release, status, shutdown }
    let operation: Operation
    var preferences: ModelPreferences? = nil
    var requestId: String? = nil
}
