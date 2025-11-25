using TranslateDemo.Domain.Entities;

namespace TranslateDemo.Domain.Abstractions;

public interface IPresignedUploadService
{
    Task<PresignedUpload> CreateAsync(string key, string contentType, long maxSizeBytes, CancellationToken ct = default);
}

public sealed record PresignedUpload(string Url, IReadOnlyDictionary<string, string> Fields);

