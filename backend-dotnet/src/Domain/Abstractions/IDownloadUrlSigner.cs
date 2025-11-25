namespace TranslateDemo.Domain.Abstractions;

public interface IDownloadUrlSigner
{
    Task<string?> SignAsync(string key, TimeSpan ttl, CancellationToken ct = default);
}

