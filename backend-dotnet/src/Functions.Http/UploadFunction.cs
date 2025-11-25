using System.Net;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.Lambda.Core;
using Functions.Shared;
using Microsoft.Extensions.DependencyInjection;
using TranslateDemo.Application.Contracts;
using TranslateDemo.Application.UseCases;
using TranslateDemo.Domain.ValueObjects;

[assembly: LambdaSerializer(typeof(Amazon.Lambda.Serialization.SystemTextJson.DefaultLambdaJsonSerializer))]

namespace TranslateDemo.Functions.Http;

public class UploadFunction
{
    private readonly CreateUploadUrlUseCase _useCase;

    public UploadFunction() : this(Bootstrap.ServiceProvider.GetRequiredService<CreateUploadUrlUseCase>()) { }

    public UploadFunction(CreateUploadUrlUseCase useCase)
    {
        _useCase = useCase;
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true
    };

    public async Task<APIGatewayProxyResponse> Handler(APIGatewayProxyRequest request, ILambdaContext context)
    {
        try
        {
            var payload = JsonSerializer.Deserialize<RequestDto>(request.Body ?? "{}", JsonOptions) ?? new RequestDto();
            if (string.IsNullOrWhiteSpace(payload.FileName) || string.IsNullOrWhiteSpace(payload.TargetLanguage))
            {
                return Response(HttpStatusCode.BadRequest, new { message = "fileName and targetLanguage are required" });
            }

            var result = await _useCase.HandleAsync(
                new CreateUploadRequest(
                    payload.FileName,
                    payload.TargetLanguage,
                    payload.SourceLanguage,
                    payload.ContentType,
                    Enum.TryParse<OutputFormat>(payload.OutputFormat, true, out var fmt) ? fmt : OutputFormat.Docx));

            return Response(HttpStatusCode.OK, new { jobId = result.JobId, upload = new { url = result.Url, fields = result.Fields } });
        }
        catch (Exception ex)
        {
            context.Logger.LogError($"Upload failed: {ex}");
            return Response(HttpStatusCode.InternalServerError, new { message = "Failed to create upload URL" });
        }
    }

    private static APIGatewayProxyResponse Response(HttpStatusCode code, object body) => new()
    {
        StatusCode = (int)code,
        Headers = new Dictionary<string, string> { ["Access-Control-Allow-Origin"] = "*", ["Access-Control-Allow-Headers"] = "*" },
        Body = JsonSerializer.Serialize(body)
    };

    private sealed record RequestDto(string? FileName = null, string? TargetLanguage = null, string? SourceLanguage = null, string? ContentType = null, string? OutputFormat = null);
}
