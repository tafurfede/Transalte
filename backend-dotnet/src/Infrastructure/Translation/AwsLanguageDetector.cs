using Amazon.Comprehend;
using Amazon.Comprehend.Model;
using TranslateDemo.Domain.Abstractions;

namespace TranslateDemo.Infrastructure.Translation;

public sealed class AwsLanguageDetector : ILanguageDetector
{
    private readonly IAmazonComprehend _client;

    public AwsLanguageDetector(IAmazonComprehend client)
    {
        _client = client;
    }

    public async Task<string?> DetectCodeAsync(string text, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;

        var request = new DetectDominantLanguageRequest { Text = text.Substring(0, Math.Min(4500, text.Length)) };
        var response = await _client.DetectDominantLanguageAsync(request, ct);
        var top = response.Languages?.OrderByDescending(l => l.Score).FirstOrDefault();
        return top?.LanguageCode?.Split('-').FirstOrDefault()?.ToLowerInvariant();
    }
}

