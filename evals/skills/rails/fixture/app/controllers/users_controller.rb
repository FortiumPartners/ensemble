class UsersController < ApplicationController
  def index
    render json: User.with_accounts.order(:name).as_json(include: :accounts)
  end

  def create
    result = Users::Register.call(user_params)

    if result.success?
      render json: result.user, status: :created
    else
      render json: { errors: result.errors }, status: :unprocessable_entity
    end
  end

  private

  def user_params
    params.require(:user).permit(:name, :email)
  end
end
