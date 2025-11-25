namespace TranslateDemo.Domain.Abstractions;

public interface IStorageService
{
    Task<Stream> GetAsync(string key, CancellationToken ct = default);
    Task PutAsync(string key, Stream content, string contentType, CancellationToken ct = default);
    string BucketName { get; }
}

