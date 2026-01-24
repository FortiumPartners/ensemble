# Rails RSpec Test Template
#
# Placeholder System:
# - {{ClassName}} → PascalCase class name (e.g., BlogPost)
# - {{class_name}} → snake_case name (e.g., blog_post)
# - {{table_name}} → Plural snake_case (e.g., blog_posts)
# - {{route_path}} → URL path (e.g., blog_posts)
# - {{ModelName}} → Associated model name (e.g., User)
# - {{association_name}} → Association name (e.g., author)
# - {{field_name}} → Field name (e.g., title)
#
# Usage Example:
# Replace placeholders with actual values:
#   {{ClassName}} = BlogPost
#   {{class_name}} = blog_post
#   {{table_name}} = blog_posts
#   {{ModelName}} = User
#   {{association_name}} = author
#
# Test Coverage Targets:
# - Models: ≥80%
# - Controllers: ≥70%
# - Services: ≥80%
# - Overall: ≥75%

# ==========================================
# MODEL SPEC
# ==========================================
# spec/models/{{class_name}}_spec.rb
require 'rails_helper'

RSpec.describe {{ClassName}}, type: :model do
  # === Associations ===
  describe 'associations' do
    it { should belong_to(:{{association_name}}).class_name('{{ModelName}}') }
    it { should have_many(:comments).dependent(:destroy) }
    it { should have_many(:tags).through(:taggings) }
  end

  # === Validations ===
  describe 'validations' do
    it { should validate_presence_of(:{{field_name}}) }
    it { should validate_presence_of(:body) }
    it { should validate_length_of(:{{field_name}}).is_at_least(5).is_at_most(200) }

    context 'when {{field_name}} is unique' do
      subject { create(:{{class_name}}) }
      it { should validate_uniqueness_of(:slug).case_insensitive }
    end
  end

  # === Scopes ===
  describe 'scopes' do
    let!(:published_{{class_name}}) { create(:{{class_name}}, published: true) }
    let!(:draft_{{class_name}}) { create(:{{class_name}}, published: false) }

    describe '.published' do
      it 'returns only published {{table_name}}' do
        expect({{ClassName}}.published).to include(published_{{class_name}})
        expect({{ClassName}}.published).not_to include(draft_{{class_name}})
      end
    end

    describe '.recent' do
      it 'orders {{table_name}} by created_at descending' do
        older = create(:{{class_name}}, created_at: 2.days.ago)
        newer = create(:{{class_name}}, created_at: 1.day.ago)

        expect({{ClassName}}.recent).to eq([newer, older, published_{{class_name}}, draft_{{class_name}}])
      end
    end
  end

  # === Class Methods ===
  describe '.search' do
    let!(:{{class_name}}_1) { create(:{{class_name}}, {{field_name}}: 'Ruby on Rails Tutorial') }
    let!(:{{class_name}}_2) { create(:{{class_name}}, body: 'Learn Ruby programming') }
    let!(:{{class_name}}_3) { create(:{{class_name}}, {{field_name}}: 'Python Guide') }

    it 'finds {{table_name}} by {{field_name}}' do
      results = {{ClassName}}.search('Ruby')
      expect(results).to include({{class_name}}_1, {{class_name}}_2)
      expect(results).not_to include({{class_name}}_3)
    end

    it 'is case insensitive' do
      expect({{ClassName}}.search('ruby')).to include({{class_name}}_1)
    end
  end

  # === Instance Methods ===
  describe '#published?' do
    it 'returns true when {{class_name}} is published' do
      {{class_name}} = build(:{{class_name}}, published: true, published_at: 1.day.ago)
      expect({{class_name}}).to be_published
    end

    it 'returns false when {{class_name}} is not published' do
      {{class_name}} = build(:{{class_name}}, published: false)
      expect({{class_name}}).not_to be_published
    end

    it 'returns false when published but no published_at date' do
      {{class_name}} = build(:{{class_name}}, published: true, published_at: nil)
      expect({{class_name}}).not_to be_published
    end
  end

  describe '#to_param' do
    it 'returns slug when present' do
      {{class_name}} = build(:{{class_name}}, slug: 'my-awesome-post')
      expect({{class_name}}.to_param).to eq('my-awesome-post')
    end

    it 'returns id when slug is blank' do
      {{class_name}} = create(:{{class_name}}, slug: nil)
      expect({{class_name}}.to_param).to eq({{class_name}}.id.to_s)
    end
  end

  # === Callbacks ===
  describe 'callbacks' do
    describe 'before_save' do
      it 'generates slug from {{field_name}}' do
        {{class_name}} = create(:{{class_name}}, {{field_name}}: 'My Awesome Post')
        expect({{class_name}}.slug).to eq('my-awesome-post')
      end

      it 'regenerates slug when {{field_name}} changes' do
        {{class_name}} = create(:{{class_name}}, {{field_name}}: 'Original Title')
        {{class_name}}.update({{field_name}}: 'Updated Title')
        expect({{class_name}}.slug).to eq('updated-title')
      end
    end

    describe 'after_create' do
      it 'enqueues notification job' do
        expect {
          create(:{{class_name}})
        }.to have_enqueued_job(Notify{{ClassName}}SubscribersJob)
      end
    end
  end
end

# ==========================================
# CONTROLLER SPEC (Request Spec)
# ==========================================
# spec/requests/{{table_name}}_spec.rb
require 'rails_helper'

RSpec.describe '{{ClassName}}s', type: :request do
  let(:{{association_name}}) { create(:{{model_name}}) }
  let(:valid_attributes) do
    {
      {{field_name}}: 'Test {{ClassName}}',
      body: 'Test body content',
      published: true,
      {{association_name}}_id: {{association_name}}.id
    }
  end
  let(:invalid_attributes) do
    { {{field_name}}: '', body: '' }
  end

  # === INDEX ===
  describe 'GET /{{route_path}}' do
    it 'returns a successful response' do
      get {{table_name}}_path
      expect(response).to be_successful
    end

    it 'renders the index template' do
      get {{table_name}}_path
      expect(response).to render_template(:index)
    end

    it 'loads all {{table_name}}' do
      {{class_name}}_1 = create(:{{class_name}})
      {{class_name}}_2 = create(:{{class_name}})

      get {{table_name}}_path
      expect(assigns(:{{table_name}})).to match_array([{{class_name}}_1, {{class_name}}_2])
    end
  end

  # === SHOW ===
  describe 'GET /{{route_path}}/:id' do
    let(:{{class_name}}) { create(:{{class_name}}) }

    it 'returns a successful response' do
      get {{class_name}}_path({{class_name}})
      expect(response).to be_successful
    end

    it 'renders the show template' do
      get {{class_name}}_path({{class_name}})
      expect(response).to render_template(:show)
    end
  end

  # === CREATE ===
  describe 'POST /{{route_path}}' do
    context 'with valid parameters' do
      it 'creates a new {{ClassName}}' do
        expect {
          post {{table_name}}_path, params: { {{class_name}}: valid_attributes }
        }.to change({{ClassName}}, :count).by(1)
      end

      it 'redirects to the created {{class_name}}' do
        post {{table_name}}_path, params: { {{class_name}}: valid_attributes }
        expect(response).to redirect_to({{ClassName}}.last)
      end

      it 'sets a flash notice' do
        post {{table_name}}_path, params: { {{class_name}}: valid_attributes }
        expect(flash[:notice]).to match(/successfully created/i)
      end
    end

    context 'with invalid parameters' do
      it 'does not create a new {{ClassName}}' do
        expect {
          post {{table_name}}_path, params: { {{class_name}}: invalid_attributes }
        }.not_to change({{ClassName}}, :count)
      end

      it 'renders the new template with unprocessable_entity status' do
        post {{table_name}}_path, params: { {{class_name}}: invalid_attributes }
        expect(response).to have_http_status(:unprocessable_entity)
        expect(response).to render_template(:new)
      end
    end
  end

  # === UPDATE ===
  describe 'PATCH /{{route_path}}/:id' do
    let(:{{class_name}}) { create(:{{class_name}}) }
    let(:new_attributes) { { {{field_name}}: 'Updated Title' } }

    context 'with valid parameters' do
      it 'updates the requested {{class_name}}' do
        patch {{class_name}}_path({{class_name}}), params: { {{class_name}}: new_attributes }
        {{class_name}}.reload
        expect({{class_name}}.{{field_name}}).to eq('Updated Title')
      end

      it 'redirects to the {{class_name}}' do
        patch {{class_name}}_path({{class_name}}), params: { {{class_name}}: new_attributes }
        expect(response).to redirect_to({{class_name}})
      end
    end

    context 'with invalid parameters' do
      it 'renders the edit template with unprocessable_entity status' do
        patch {{class_name}}_path({{class_name}}), params: { {{class_name}}: invalid_attributes }
        expect(response).to have_http_status(:unprocessable_entity)
        expect(response).to render_template(:edit)
      end
    end
  end

  # === DESTROY ===
  describe 'DELETE /{{route_path}}/:id' do
    let!(:{{class_name}}) { create(:{{class_name}}) }

    it 'destroys the requested {{class_name}}' do
      expect {
        delete {{class_name}}_path({{class_name}})
      }.to change({{ClassName}}, :count).by(-1)
    end

    it 'redirects to the {{table_name}} list' do
      delete {{class_name}}_path({{class_name}})
      expect(response).to redirect_to({{table_name}}_path)
    end
  end
end

# ==========================================
# API REQUEST SPEC
# ==========================================
# spec/requests/api/v1/{{table_name}}_spec.rb
require 'rails_helper'

RSpec.describe 'Api::V1::{{ClassName}}s', type: :request do
  let(:{{association_name}}) { create(:{{model_name}}) }
  let(:headers) { { 'Authorization' => "Bearer #{{{association_name}}.api_token}" } }

  describe 'GET /api/v1/{{route_path}}' do
    it 'returns all published {{table_name}}' do
      create_list(:{{class_name}}, 3, published: true)
      create(:{{class_name}}, published: false)

      get '/api/v1/{{route_path}}'

      expect(response).to have_http_status(:success)
      json = JSON.parse(response.body)
      expect(json.size).to eq(3)
    end

    it 'paginates results' do
      create_list(:{{class_name}}, 25, published: true)

      get '/api/v1/{{route_path}}', params: { page: 1, per_page: 10 }

      expect(response).to have_http_status(:success)
      json = JSON.parse(response.body)
      expect(json.size).to eq(10)
    end
  end

  describe 'POST /api/v1/{{route_path}}' do
    let(:valid_params) do
      { {{class_name}}: { {{field_name}}: 'New {{ClassName}}', body: '{{ClassName}} body' } }
    end

    context 'with valid parameters' do
      it 'creates a new {{class_name}}' do
        expect {
          post '/api/v1/{{route_path}}', params: valid_params, headers: headers
        }.to change({{ClassName}}, :count).by(1)

        expect(response).to have_http_status(:created)
      end

      it 'returns the created {{class_name}}' do
        post '/api/v1/{{route_path}}', params: valid_params, headers: headers

        json = JSON.parse(response.body)
        expect(json['{{field_name}}']).to eq('New {{ClassName}}')
      end
    end

    context 'with invalid parameters' do
      it 'returns error messages' do
        invalid_params = { {{class_name}}: { {{field_name}}: '' } }
        post '/api/v1/{{route_path}}', params: invalid_params, headers: headers

        expect(response).to have_http_status(:unprocessable_entity)
        json = JSON.parse(response.body)
        expect(json['errors']).to be_present
      end
    end

    context 'without authentication' do
      it 'returns unauthorized' do
        post '/api/v1/{{route_path}}', params: valid_params

        expect(response).to have_http_status(:unauthorized)
      end
    end
  end
end

# ==========================================
# SERVICE SPEC
# ==========================================
# spec/services/create_{{class_name}}_service_spec.rb
require 'rails_helper'

RSpec.describe Create{{ClassName}}Service do
  let(:{{association_name}}) { create(:{{model_name}}) }
  let(:valid_params) do
    { {{field_name}}: 'Test {{ClassName}}', body: 'Test body' }
  end

  describe '#call' do
    context 'with valid parameters' do
      it 'creates a {{class_name}}' do
        expect {
          described_class.new({{association_name}}, valid_params).call
        }.to change({{ClassName}}, :count).by(1)
      end

      it 'returns a success result' do
        result = described_class.new({{association_name}}, valid_params).call

        expect(result).to be_success
        expect(result.value).to be_a({{ClassName}})
      end

      it 'enqueues notification job' do
        expect {
          described_class.new({{association_name}}, valid_params).call
        }.to have_enqueued_job({{ClassName}}Mailer)
      end
    end

    context 'with invalid parameters' do
      let(:invalid_params) { { {{field_name}}: '' } }

      it 'does not create a {{class_name}}' do
        expect {
          described_class.new({{association_name}}, invalid_params).call
        }.not_to change({{ClassName}}, :count)
      end

      it 'returns a failure result' do
        result = described_class.new({{association_name}}, invalid_params).call

        expect(result).to be_failure
        expect(result.errors).to be_present
      end
    end
  end
end

# ==========================================
# JOB SPEC
# ==========================================
# spec/jobs/send_{{class_name}}_email_job_spec.rb
require 'rails_helper'

RSpec.describe Send{{ClassName}}EmailJob, type: :job do
  let(:{{class_name}}) { create(:{{class_name}}) }

  describe '#perform' do
    it 'sends the email' do
      expect {
        described_class.perform_now({{class_name}}.id)
      }.to change { ActionMailer::Base.deliveries.count }.by(1)
    end

    it 'handles missing {{class_name}}' do
      expect {
        described_class.perform_now(99999)
      }.not_to raise_error
    end
  end

  describe 'retry behavior' do
    it 'retries on transient errors' do
      allow({{ClassName}}Mailer).to receive(:welcome_email).and_raise(Net::SMTPServerBusy)

      expect {
        described_class.perform_now({{class_name}}.id)
      }.to raise_error(Net::SMTPServerBusy)

      expect(described_class).to have_been_enqueued.with({{class_name}}.id)
    end
  end
end

# ==========================================
# FACTORY BOT
# ==========================================
# spec/factories/{{table_name}}.rb
FactoryBot.define do
  factory :{{class_name}} do
    sequence(:{{field_name}}) { |n| "{{ClassName}} Title #{n}" }
    body { Faker::Lorem.paragraphs(number: 3).join("\n\n") }
    published { false }
    association :{{association_name}}, factory: :{{model_name}}

    trait :published do
      published { true }
      published_at { 1.day.ago }
    end

    trait :with_comments do
      after(:create) do |{{class_name}}|
        create_list(:comment, 3, {{class_name}}: {{class_name}})
      end
    end

    trait :with_tags do
      after(:create) do |{{class_name}}|
        create_list(:tag, 2, {{table_name}}: [{{class_name}}])
      end
    end
  end
end

# Usage:
# create(:{{class_name}})                           # Draft {{class_name}}
# create(:{{class_name}}, :published)               # Published {{class_name}}
# create(:{{class_name}}, :published, :with_comments) # Published with 3 comments
# build(:{{class_name}})                            # Build without saving

# ==========================================
# BEST PRACTICES
# ==========================================
#
# 1. Use descriptive test names
#    - Follow "it does something" pattern
#    - Be specific about what is being tested
#
# 2. Follow AAA pattern (Arrange, Act, Assert)
#    - Set up data (let, before)
#    - Execute code under test
#    - Verify expectations
#
# 3. Use factories instead of fixtures
#    - Factories are more flexible
#    - Build strategy for fast tests (build vs create)
#
# 4. Test one thing per example
#    - Keep tests focused and isolated
#    - Multiple expectations OK if testing same behavior
#
# 5. Use contexts for different scenarios
#    - Group related tests
#    - Make test structure clear
#
# 6. Mock external services
#    - Don't make real API calls in tests
#    - Use VCR or WebMock for HTTP requests
#
# 7. Test edge cases and error paths
#    - Invalid input
#    - Missing records
#    - Permission errors
#
# 8. Keep tests fast
#    - Use build instead of create when possible
#    - Don't create unnecessary records
#    - Run tests in parallel
#
# 9. Maintain test coverage
#    - Use SimpleCov to track coverage
#    - Aim for ≥75% overall, ≥80% models
#
# 10. Run tests before committing
#     - Set up pre-commit hooks
#     - Fix failing tests immediately
