require "rails_helper"

RSpec.describe "Users", type: :request do
  describe "GET /users" do
    it "lists users with their accounts" do
      user = create(:user, name: "Ada")

      get "/users"

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body.map { |u| u["name"] }).to include(user.name)
    end
  end
end
