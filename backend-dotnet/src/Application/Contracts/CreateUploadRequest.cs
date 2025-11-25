using TranslateDemo.Domain.ValueObjects;

namespace TranslateDemo.Application.Contracts;

public sealed record CreateUploadRequest(
    string FileName,
    string TargetLanguage,
    string? SourceLanguage,
    string? ContentType,
    OutputFormat OutputFormat);

public sealed record CreateUploadResponse(string JobId, string Url, IReadOnlyDictionary<string, string> Fields);

