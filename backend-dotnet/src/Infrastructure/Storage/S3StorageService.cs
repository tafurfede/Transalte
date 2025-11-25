using Amazon.S3;
using Amazon.S3.Model;
using TranslateDemo.Domain.Abstractions;

namespace TranslateDemo.Infrastructure.Storage;

public sealed class S3StorageService : IStorageService, IDownloadUrlSigner
{
    private readonly IAmazonS3 _s3;
    private readonly TimeSpan _defaultTtl = TimeSpan.FromMinutes(10);
    public string BucketName { get; }

    public S3StorageService(IAmazonS3 s3, string bucketName)
    {
        _s3 = s3;
        BucketName = bucketName;
    }

    public async Task<Stream> GetAsync(string key, CancellationToken ct = default)
    {
        var response = await _s3.GetObjectAsync(new GetObjectRequest { BucketName = BucketName, Key = key }, ct);
        return response.ResponseStream;
    }

    public async Task PutAsync(string key, Stream content, string contentType, CancellationToken ct = default)
    {
        var req = new PutObjectRequest
        {
            BucketName = BucketName,
            Key = key,
            InputStream = content,
            ContentType = contentType
        };
        await _s3.PutObjectAsync(req, ct);
    }

    public async Task<string?> SignAsync(string key, TimeSpan ttl, CancellationToken ct = default)
    {
        var fileName = System.IO.Path.GetFileName(key);
        var request = new GetPreSignedUrlRequest
        {
            BucketName = BucketName,
            Key = key,
            Expires = DateTime.UtcNow.Add(ttl <= TimeSpan.Zero ? _defaultTtl : ttl),
            ResponseHeaderOverrides = new ResponseHeaderOverrides
            {
                ContentDisposition = $"attachment; filename=\"{fileName}\""
            }
        };
        return await Task.FromResult(_s3.GetPreSignedURL(request));
    }
}
